package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"depot/internal/api"
	"depot/internal/store"
	"depot/migrations"
)

// Fixed identifiers keep tests readable. The test database is truncated
// between tests, so reusing them is safe; prodMissing sorts after prodA and
// prodB, which makes lock-order rollback paths deterministic.
const (
	testWarehouse = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	prodA         = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	prodB         = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	prodMissing   = "ffffffff-ffff-4fff-8fff-ffffffffffff"
	unknownUUID   = "deadbeef-dead-4bee-8ade-deaddeaddead"
)

var (
	testStore   *store.Store
	testHandler http.Handler
	// dbUnavailableReason is set when PostgreSQL could not be prepared; DB-backed
	// tests then skip with this documented environmental reason while unit and
	// handler tests that need no database still run.
	dbUnavailableReason string
)

func TestEnsureDatabaseRejectsNonTestDatabase(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	err := ensureDatabase(ctx, "postgres://user:placeholder@127.0.0.1:5432/depot?sslmode=disable")
	if err == nil || !strings.Contains(err.Error(), "must end in _test") {
		t.Fatalf("ensureDatabase error = %v, want a _test suffix rejection", err)
	}
}

// TestMain prepares a real PostgreSQL test database, applies the actual
// migrations and runs the suite. When PostgreSQL is unreachable it warns
// loudly and marks integration tests as environmentally skipped — it never
// substitutes mocks or an in-memory database for PostgreSQL correctness.
func TestMain(m *testing.M) {
	dsn := os.Getenv("DEPOT_TEST_DATABASE_URL")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var st *store.Store
	var err error
	if strings.TrimSpace(dsn) == "" {
		err = fmt.Errorf("DEPOT_TEST_DATABASE_URL is not set; integration tests require a dedicated PostgreSQL test database")
	} else {
		st, err = prepareTestDatabase(ctx, dsn)
	}
	if err != nil {
		dbUnavailableReason = err.Error()
		fmt.Fprintf(os.Stderr,
			"\nWARNING: PostgreSQL integration tests will be SKIPPED: %v\n"+
				"         Set DEPOT_TEST_DATABASE_URL to a reachable PostgreSQL to run them.\n\n",
			dbUnavailableReason)
		testHandler = api.NewServer(nil).Routes() // health/CORS/unit tests need no store
		os.Exit(m.Run())
	}

	testStore = st
	testHandler = api.NewServer(st).Routes()
	code := m.Run()
	st.Close()
	os.Exit(code)
}

// prepareTestDatabase creates the database if needed, connects and applies
// the real migrations (migrations/0000_baseline.sql) — no shortcuts.
func prepareTestDatabase(ctx context.Context, dsn string) (*store.Store, error) {
	if err := ensureDatabase(ctx, dsn); err != nil {
		return nil, fmt.Errorf("prepare test database: %w", err)
	}
	st, err := store.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := st.ApplyMigrations(ctx, migrations.FS); err != nil {
		st.Close()
		return nil, fmt.Errorf("apply migrations: %w", err)
	}
	return st, nil
}

// requireDB skips a PostgreSQL-backed test with the documented environmental
// reason when the database could not be prepared.
func requireDB(t *testing.T) {
	t.Helper()
	if dbUnavailableReason != "" {
		t.Skipf("PostgreSQL unavailable (environmental): %s", dbUnavailableReason)
	}
}

// dbCtx bounds database operations so a stuck database fails the test instead
// of hanging the whole suite.
func dbCtx(t *testing.T) (context.Context, context.CancelFunc) {
	t.Helper()
	return context.WithTimeout(context.Background(), 15*time.Second)
}

// ensureDatabase creates the target database if it does not exist yet.
func ensureDatabase(ctx context.Context, dsn string) error {
	u, err := url.Parse(dsn)
	if err != nil {
		return fmt.Errorf("parse database URL: %w", err)
	}
	dbName := strings.TrimPrefix(u.Path, "/")
	if dbName == "" {
		return fmt.Errorf("database URL has no database name")
	}
	if !strings.HasSuffix(dbName, "_test") {
		return fmt.Errorf("database name %q must end in _test because the integration suite truncates its tables", dbName)
	}
	u.Path = "/postgres"
	u.RawQuery = ""
	admin, err := pgx.Connect(ctx, u.String())
	if err != nil {
		return fmt.Errorf("connect to the postgres database: %w", err)
	}
	defer admin.Close(ctx)

	var exists bool
	if err := admin.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)`, dbName,
	).Scan(&exists); err != nil {
		return fmt.Errorf("check database: %w", err)
	}
	if !exists {
		if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{dbName}.Sanitize()); err != nil {
			return fmt.Errorf("create database: %w", err)
		}
	}
	return nil
}

// resp is one API response.
type resp struct {
	code   int
	header http.Header
	body   map[string]any
}

func (r resp) errCode() string {
	if e, ok := r.body["error"].(map[string]any); ok {
		if c, ok := e["code"].(string); ok {
			return c
		}
	}
	return ""
}

func (r resp) id() string {
	id, ok := r.body["id"].(string)
	if !ok {
		panic(fmt.Sprintf("response has no id: %#v", r.body))
	}
	return id
}

func (r resp) str(field string) string {
	s, _ := r.body[field].(string)
	return s
}

// reset deletes all data so every test starts from a clean, repeatable state.
// It is the entry point for every PostgreSQL-backed test, so it also applies
// requireDB and a context timeout.
func reset(t *testing.T) {
	t.Helper()
	requireDB(t)
	ctx, cancel := dbCtx(t)
	defer cancel()
	_, err := testStore.Pool.Exec(ctx, `
		TRUNCATE TABLE reservation_items, reservations,
		             stock, products, warehouses
		RESTART IDENTITY CASCADE`)
	if err != nil {
		t.Fatalf("truncate test data: %v", err)
	}
}

// call performs a JSON request against the in-process API (worker goroutines
// should use doRequest instead).
func call(t *testing.T, method, path string, body any, headers map[string]string) resp {
	t.Helper()
	r, err := doRequest(method, path, marshalBody(t, body), headers)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return r
}

func marshalBody(t *testing.T, body any) string {
	t.Helper()
	if body == nil {
		return ""
	}
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}
	return string(b)
}

// doRequest performs a request without touching *testing.T, so it is safe to
// call from worker goroutines.
func doRequest(method, path, rawBody string, headers map[string]string) (resp, error) {
	var rdr io.Reader
	if rawBody != "" {
		rdr = bytes.NewReader([]byte(rawBody))
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	testHandler.ServeHTTP(rec, req)

	out := resp{code: rec.Code, header: rec.Header().Clone(), body: map[string]any{}}
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out.body); err != nil {
			return out, fmt.Errorf("response is not JSON: %v (body %q)", err, rec.Body.String())
		}
	}
	return out, nil
}

func keyHeader(key string) map[string]string {
	return map[string]string{"Idempotency-Key": key}
}

// seedStock sets stock through the public API (which creates missing
// warehouse/product rows) and fails the test on error.
func seedStock(t *testing.T, warehouseID, productID string, quantity int64) {
	t.Helper()
	r := call(t, http.MethodPost, fmt.Sprintf("/warehouses/%s/stock", warehouseID),
		map[string]any{"product_id": productID, "quantity": quantity}, nil)
	if r.code != http.StatusOK {
		t.Fatalf("seed stock w=%s p=%s q=%d: status %d body %v",
			warehouseID, productID, quantity, r.code, r.body)
	}
}

// createReservation POSTs /reservations with an Idempotency-Key (unless key is "").
func createReservation(t *testing.T, warehouseID string, items []store.ReservationItem, key string) resp {
	t.Helper()
	hdrs := map[string]string{}
	if key != "" {
		hdrs = keyHeader(key)
	}
	return call(t, http.MethodPost, "/reservations",
		map[string]any{"warehouse_id": warehouseID, "items": items}, hdrs)
}

// mustCreate creates a reservation and returns its id.
func mustCreate(t *testing.T, warehouseID string, items []store.ReservationItem, key string) string {
	t.Helper()
	r := createReservation(t, warehouseID, items, key)
	if r.code != http.StatusCreated {
		t.Fatalf("create reservation: status %d body %v", r.code, r.body)
	}
	return r.id()
}

// stockOf reads the stock picture for one product in one warehouse.
func stockOf(t *testing.T, warehouseID, productID string) (physical, reserved, available int64) {
	t.Helper()
	r := call(t, http.MethodGet,
		fmt.Sprintf("/warehouses/%s/products/%s/stock", warehouseID, productID), nil, nil)
	if r.code != http.StatusOK {
		t.Fatalf("get stock: status %d body %v", r.code, r.body)
	}
	return int64(r.body["physical_stock"].(float64)),
		int64(r.body["reserved_stock"].(float64)),
		int64(r.body["available_stock"].(float64))
}

// count runs a scalar COUNT query against the test database.
func count(t *testing.T, sql string, args ...any) int64 {
	t.Helper()
	ctx, cancel := dbCtx(t)
	defer cancel()
	var n int64
	if err := testStore.Pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
		t.Fatalf("count query %q: %v", sql, err)
	}
	return n
}

// expireNow ages a reservation so it is expired by the database clock. Both
// timestamps move into the past because the schema enforces
// expires_at > created_at.
func expireNow(t *testing.T, reservationID string) {
	t.Helper()
	ctx, cancel := dbCtx(t)
	defer cancel()
	tag, err := testStore.Pool.Exec(ctx, `
		UPDATE reservations
		SET created_at = now() - interval '1 hour',
		    expires_at = now() - interval '1 minute'
		WHERE id = $1`,
		reservationID)
	if err != nil {
		t.Fatalf("expire reservation: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("expire reservation %s: no row updated", reservationID)
	}
}
