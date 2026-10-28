package api_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"depot/internal/store"
)

// TestHealth checks the liveness endpoint kept from the original scaffold.
func TestHealth(t *testing.T) {
	r := call(t, http.MethodGet, "/api/health", nil, nil)
	if r.code != http.StatusOK || r.str("status") != "ok" {
		t.Fatalf("health: status %d body %v", r.code, r.body)
	}
}

// TestStockEndpoints covers seeding and reading stock plus its validation:
// set, get, unknown resource (404), bad ids (400), and refusing to set stock
// below what reservations already hold (409).
func TestStockEndpoints(t *testing.T) {
	reset(t)

	seedStock(t, testWarehouse, prodA, 100)
	p, res, avail := stockOf(t, testWarehouse, prodA)
	if p != 100 || res != 0 || avail != 100 {
		t.Fatalf("after seed: physical=%d reserved=%d available=%d", p, res, avail)
	}

	// Updating stock keeps the same picture.
	seedStock(t, testWarehouse, prodA, 40)
	if p, _, avail = stockOf(t, testWarehouse, prodA); p != 40 || avail != 40 {
		t.Fatalf("after update: physical=%d available=%d", p, avail)
	}

	// Unknown product in a known warehouse -> 404.
	if r := call(t, http.MethodGet,
		fmt.Sprintf("/warehouses/%s/products/%s/stock", testWarehouse, unknownUUID), nil, nil); r.code != http.StatusNotFound {
		t.Fatalf("unknown product: status %d body %v", r.code, r.body)
	}

	// Negative quantity -> 400.
	r := call(t, http.MethodPost, fmt.Sprintf("/warehouses/%s/stock", testWarehouse),
		map[string]any{"product_id": prodA, "quantity": -1}, nil)
	if r.code != http.StatusBadRequest {
		t.Fatalf("negative stock: status %d body %v", r.code, r.body)
	}

	// Invalid path ids -> 400.
	for _, path := range []string{
		"/warehouses/abc/products/" + prodA + "/stock",
		"/warehouses/0/products/" + prodA + "/stock",
		"/warehouses/not-a-uuid/products/" + prodA + "/stock",
	} {
		if r := call(t, http.MethodGet, path, nil, nil); r.code != http.StatusBadRequest {
			t.Fatalf("path %s: status %d body %v", path, r.code, r.body)
		}
	}

	// Stock can never be set below what pending reservations hold.
	mustCreate(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 30}}, "k-below")
	r = call(t, http.MethodPost, fmt.Sprintf("/warehouses/%s/stock", testWarehouse),
		map[string]any{"product_id": prodA, "quantity": 10}, nil)
	if r.code != http.StatusConflict || r.errCode() != "stock_below_reserved" {
		t.Fatalf("set below reserved: status %d body %v", r.code, r.body)
	}
	// The rejected write must not have changed anything.
	if _, res, avail := stockOf(t, testWarehouse, prodA); res != 30 || avail != 10 {
		t.Fatalf("after rejected write: reserved=%d available=%d", res, avail)
	}
}

func TestCatalogEndpoints(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 25)

	warehouseResponse := httptest.NewRecorder()
	testHandler.ServeHTTP(warehouseResponse, httptest.NewRequest(http.MethodGet, "/warehouses", nil))
	if warehouseResponse.Code != http.StatusOK {
		t.Fatalf("list warehouses: status %d body %s", warehouseResponse.Code, warehouseResponse.Body.String())
	}
	var warehouses []store.Warehouse
	if err := json.Unmarshal(warehouseResponse.Body.Bytes(), &warehouses); err != nil {
		t.Fatalf("decode warehouses: %v", err)
	}
	if len(warehouses) != 1 || warehouses[0].ID != testWarehouse || warehouses[0].Name == "" {
		t.Fatalf("warehouses = %#v", warehouses)
	}

	productResponse := httptest.NewRecorder()
	testHandler.ServeHTTP(productResponse, httptest.NewRequest(http.MethodGet, "/products", nil))
	if productResponse.Code != http.StatusOK {
		t.Fatalf("list products: status %d body %s", productResponse.Code, productResponse.Body.String())
	}
	var products []store.Product
	if err := json.Unmarshal(productResponse.Body.Bytes(), &products); err != nil {
		t.Fatalf("decode products: %v", err)
	}
	if len(products) != 1 || products[0].ID != prodA || products[0].SKU == "" || products[0].Name == "" {
		t.Fatalf("products = %#v", products)
	}
}

// TestCreateValidMultiItemReservation: required test 1 — a valid multi-item
// reservation reserves every item, expires 15 minutes after creation (database
// clock) and is retrievable.
func TestCreateValidMultiItemReservation(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)
	seedStock(t, testWarehouse, prodB, 50)

	r := createReservation(t, testWarehouse, []store.ReservationItem{
		{ProductID: prodA, Quantity: 3},
		{ProductID: prodB, Quantity: 5},
	}, "k-multi")
	if r.code != http.StatusCreated {
		t.Fatalf("create: status %d body %v", r.code, r.body)
	}
	if r.str("status") != "pending" {
		t.Fatalf("status = %q, want pending", r.str("status"))
	}
	if r.str("warehouse_id") != testWarehouse {
		t.Fatalf("warehouse_id = %q, want %q", r.str("warehouse_id"), testWarehouse)
	}

	// Expires 15 minutes after creation.
	created, err := time.Parse(time.RFC3339Nano, r.str("created_at"))
	if err != nil {
		t.Fatalf("parse created_at: %v", err)
	}
	expires, err := time.Parse(time.RFC3339Nano, r.str("expires_at"))
	if err != nil {
		t.Fatalf("parse expires_at: %v", err)
	}
	if d := expires.Sub(created); d < 14*time.Minute || d > 16*time.Minute {
		t.Fatalf("lifetime = %v, want ~15m", d)
	}

	// Both items are held.
	if _, res, avail := stockOf(t, testWarehouse, prodA); res != 3 || avail != 97 {
		t.Fatalf("product A: reserved=%d available=%d", res, avail)
	}
	if _, res, avail := stockOf(t, testWarehouse, prodB); res != 5 || avail != 45 {
		t.Fatalf("product B: reserved=%d available=%d", res, avail)
	}

	// Retrieval returns both items.
	id := r.id()
	got := call(t, http.MethodGet, fmt.Sprintf("/reservations/%s", id), nil, nil)
	if got.code != http.StatusOK || got.str("status") != "pending" {
		t.Fatalf("get: status %d body %v", got.code, got.body)
	}
	if items := got.body["items"].([]any); len(items) != 2 {
		t.Fatalf("items = %v", got.body["items"])
	}

	// Database state agrees with the API: one pending row for this warehouse,
	// a 15-minute lifetime measured by the database clock, and exactly two
	// item rows holding 8 units in total.
	ctx, cancel := dbCtx(t)
	defer cancel()
	var status, wh string
	var lifetimeMinutes float64
	if err := testStore.Pool.QueryRow(ctx, `
		SELECT status, warehouse_id,
		       EXTRACT(EPOCH FROM (expires_at - created_at)) / 60
		FROM reservations WHERE id = $1`, id,
	).Scan(&status, &wh, &lifetimeMinutes); err != nil {
		t.Fatalf("read reservation row: %v", err)
	}
	if status != "pending" || wh != testWarehouse {
		t.Fatalf("db row: status=%q warehouse=%q", status, wh)
	}
	if lifetimeMinutes < 14 || lifetimeMinutes > 16 {
		t.Fatalf("db lifetime = %.1f minutes, want ~15", lifetimeMinutes)
	}
	var itemRows, totalUnits int64
	if err := testStore.Pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(SUM(quantity), 0)
		FROM reservation_items WHERE reservation_id = $1`, id,
	).Scan(&itemRows, &totalUnits); err != nil {
		t.Fatalf("read item rows: %v", err)
	}
	if itemRows != 2 || totalUnits != 8 {
		t.Fatalf("db items: rows=%d units=%d, want 2 rows / 8 units", itemRows, totalUnits)
	}
}

// TestCreateRollsBackWhenOneItemLacksStock: required test 2 — one item short
// of stock aborts everything: no reservation, no held stock, no idempotency
// record, and the same key can be retried afterwards.
func TestCreateRollsBackWhenOneItemLacksStock(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)
	seedStock(t, testWarehouse, prodB, 1)

	r := createReservation(t, testWarehouse, []store.ReservationItem{
		{ProductID: prodA, Quantity: 3},
		{ProductID: prodB, Quantity: 50},
	}, "k-partial")
	if r.code != http.StatusConflict || r.errCode() != "insufficient_stock" {
		t.Fatalf("create: status %d body %v", r.code, r.body)
	}

	if _, res, avail := stockOf(t, testWarehouse, prodA); res != 0 || avail != 100 {
		t.Fatalf("product A after rollback: reserved=%d available=%d", res, avail)
	}
	if _, res, avail := stockOf(t, testWarehouse, prodB); res != 0 || avail != 1 {
		t.Fatalf("product B after rollback: reserved=%d available=%d", res, avail)
	}
	if n := count(t, `SELECT count(*) FROM reservations`); n != 0 {
		t.Fatalf("reservations = %d, want 0", n)
	}
	if n := count(t, `SELECT count(*) FROM reservation_items`); n != 0 {
		t.Fatalf("reservation_items = %d, want 0", n)
	}

	// The key is still usable: retry with a valid request succeeds.
	if retry := createReservation(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 3}}, "k-partial"); retry.code != http.StatusCreated {
		t.Fatalf("retry with same key: status %d body %v", retry.code, retry.body)
	}
}

// TestConfirmReservation: required test 3 — confirming stops the reservation
// from holding stock, and repeating the confirmation is idempotent.
func TestConfirmReservation(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)
	id := mustCreate(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 3}}, "k-confirm")

	r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/confirm", id), nil, nil)
	if r.code != http.StatusOK || r.str("status") != "confirmed" {
		t.Fatalf("confirm: status %d body %v", r.code, r.body)
	}

	if _, res, avail := stockOf(t, testWarehouse, prodA); res != 0 || avail != 100 {
		t.Fatalf("confirmed reservation still holds stock: reserved=%d available=%d", res, avail)
	}

	// Repeating the confirmation must not apply the transition twice.
	again := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/confirm", id), nil, nil)
	if again.code != http.StatusOK || again.str("status") != "confirmed" || again.id() != id {
		t.Fatalf("repeat confirm: status %d body %v", again.code, again.body)
	}
	if n := count(t, `SELECT count(*) FROM reservations`); n != 1 {
		t.Fatalf("reservations = %d, want 1", n)
	}

	// Database state: exactly one row, stored status confirmed.
	var status string
	if err := testStore.Pool.QueryRow(t.Context(),
		`SELECT status FROM reservations WHERE id = $1`, id).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "confirmed" {
		t.Fatalf("stored status = %q, want confirmed", status)
	}
}

// TestCancelReleasesStock: required test 4 — cancelling releases the hold,
// keeps the history row, and is idempotent.
func TestCancelReleasesStock(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)
	id := mustCreate(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 3}}, "k-cancel")

	if _, res, avail := stockOf(t, testWarehouse, prodA); res != 3 || avail != 97 {
		t.Fatalf("before cancel: reserved=%d available=%d", res, avail)
	}

	r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/cancel", id), nil, nil)
	if r.code != http.StatusOK || r.str("status") != "cancelled" {
		t.Fatalf("cancel: status %d body %v", r.code, r.body)
	}
	if _, res, avail := stockOf(t, testWarehouse, prodA); res != 0 || avail != 100 {
		t.Fatalf("after cancel: reserved=%d available=%d", res, avail)
	}

	// History is kept, and a repeat cancel is idempotent.
	if n := count(t, `SELECT count(*) FROM reservations`); n != 1 {
		t.Fatalf("reservations = %d, want 1 (history kept)", n)
	}
	again := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/cancel", id), nil, nil)
	if again.code != http.StatusOK || again.str("status") != "cancelled" {
		t.Fatalf("repeat cancel: status %d body %v", again.code, again.body)
	}

	// Database state: stored status cancelled, history row kept, hold released
	// in the database (reserved sum is back to zero).
	var status string
	if err := testStore.Pool.QueryRow(t.Context(),
		`SELECT status FROM reservations WHERE id = $1`, id).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "cancelled" {
		t.Fatalf("stored status = %q, want cancelled", status)
	}
	if n := count(t, `SELECT COALESCE(SUM(quantity), 0) FROM reservation_items ri JOIN reservations r ON r.id = ri.reservation_id WHERE r.status = 'pending'`); n != 0 {
		t.Fatalf("pending reserved units = %d, want 0", n)
	}
}

// TestConfirmAfterExpirationRejected: required test 5 — expiration is judged
// by the database clock; an expired reservation cannot be confirmed and reads
// back as expired.
func TestConfirmAfterExpirationRejected(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)
	id := mustCreate(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 3}}, "k-expire")
	expireNow(t, id)

	r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/confirm", id), nil, nil)
	if r.code != http.StatusConflict || r.errCode() != "reservation_expired" {
		t.Fatalf("confirm expired: status %d body %v", r.code, r.body)
	}

	got := call(t, http.MethodGet, fmt.Sprintf("/reservations/%s", id), nil, nil)
	if got.code != http.StatusOK || got.str("status") != "expired" {
		t.Fatalf("get expired: status %d body %v", got.code, got.body)
	}
}

// TestIdempotentReplay: required test 6 — the same key with the same body
// returns the original reservation instead of creating another one.
func TestIdempotentReplay(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)
	items := []store.ReservationItem{{ProductID: prodA, Quantity: 3}}

	first := createReservation(t, testWarehouse, items, "k-replay")
	if first.code != http.StatusCreated {
		t.Fatalf("first create: status %d body %v", first.code, first.body)
	}

	second := createReservation(t, testWarehouse, items, "k-replay")
	if second.code != http.StatusCreated {
		t.Fatalf("replay: status %d body %v", second.code, second.body)
	}
	if second.id() != first.id() {
		t.Fatalf("replay id = %s, want original %s", second.id(), first.id())
	}
	if second.header.Get("X-Idempotent-Replay") != "true" {
		t.Fatalf("replay missing X-Idempotent-Replay header: %v", second.header)
	}
	if n := count(t, `SELECT count(*) FROM reservations`); n != 1 {
		t.Fatalf("reservations = %d, want 1", n)
	}
	// The hold must not be doubled either.
	if _, res, _ := stockOf(t, testWarehouse, prodA); res != 3 {
		t.Fatalf("reserved = %d, want 3", res)
	}
}

// TestIdempotencyKeyDifferentRequest: required test 7 — reusing a key with a
// different body is a 409 and creates nothing.
func TestIdempotencyKeyDifferentRequest(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)

	first := createReservation(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 3}}, "k-diff")
	if first.code != http.StatusCreated {
		t.Fatalf("first create: status %d body %v", first.code, first.body)
	}

	other := createReservation(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 4}}, "k-diff")
	if other.code != http.StatusConflict || other.errCode() != "idempotency_conflict" {
		t.Fatalf("reused key: status %d body %v", other.code, other.body)
	}
	if n := count(t, `SELECT count(*) FROM reservations`); n != 1 {
		t.Fatalf("reservations = %d, want 1", n)
	}
}

// TestInvalidRequests: required test 10 — malformed bodies, invalid ids and
// unreasonable quantities are all rejected with 400 and create nothing.
func TestInvalidRequests(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)

	valid := fmt.Sprintf(`{"warehouse_id":"%s","items":[{"product_id":"%s","quantity":1}]}`, testWarehouse, prodA)
	cases := []struct {
		name string
		path string
		body string
		hdrs map[string]string
	}{
		{"malformed JSON", "/reservations", `{"warehouse_id":"`, keyHeader("k1")},
		{"unknown field", "/reservations", fmt.Sprintf(`{"warehouse_id":"%s","items":[{"product_id":"%s","quantity":1}],"extra":1}`, testWarehouse, prodA), keyHeader("k2")},
		{"trailing object", "/reservations", valid + valid, keyHeader("k3")},
		{"empty items", "/reservations", fmt.Sprintf(`{"warehouse_id":"%s","items":[]}`, testWarehouse), keyHeader("k4")},
		{"missing items", "/reservations", fmt.Sprintf(`{"warehouse_id":"%s"}`, testWarehouse), keyHeader("k5")},
		{"zero quantity", "/reservations", fmt.Sprintf(`{"warehouse_id":"%s","items":[{"product_id":"%s","quantity":0}]}`, testWarehouse, prodA), keyHeader("k6")},
		{"negative quantity", "/reservations", fmt.Sprintf(`{"warehouse_id":"%s","items":[{"product_id":"%s","quantity":-5}]}`, testWarehouse, prodA), keyHeader("k7")},
		{"quantity too large", "/reservations", fmt.Sprintf(`{"warehouse_id":"%s","items":[{"product_id":"%s","quantity":1000001}]}`, testWarehouse, prodA), keyHeader("k8")},
		{"duplicate product", "/reservations", fmt.Sprintf(`{"warehouse_id":"%s","items":[{"product_id":"%s","quantity":1},{"product_id":"%s","quantity":2}]}`, testWarehouse, prodA, prodA), keyHeader("k9")},
		{"non-integer quantity", "/reservations", fmt.Sprintf(`{"warehouse_id":"%s","items":[{"product_id":"%s","quantity":"3"}]}`, testWarehouse, prodA), keyHeader("k10")},
		{"warehouse not a uuid", "/reservations", fmt.Sprintf(`{"warehouse_id":"%d","items":[{"product_id":"%s","quantity":1}]}`, 1, prodA), keyHeader("k11")},
		{"product not a uuid", "/reservations", fmt.Sprintf(`{"warehouse_id":"%s","items":[{"product_id":"999","quantity":1}]}`, testWarehouse), keyHeader("k12")},
		{"missing idempotency key", "/reservations", valid, nil},
		{"bad reservation id", "/reservations/abc", "", nil},
		{"zero reservation id", "/reservations/0/confirm", "", nil},
		{"bad confirm id", "/reservations/xyz/confirm", "", nil},
		{"bad stock path id", "/warehouses/zzz/stock", `{"product_id":"` + prodA + `","quantity":1}`, nil},
		{"negative stock quantity", "/warehouses/" + testWarehouse + "/stock", fmt.Sprintf(`{"product_id":"%s","quantity":-2}`, prodA), nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			method := http.MethodPost
			if tc.path == "/reservations/abc" {
				method = http.MethodGet
			}
			raw, errResp := doRequest(method, tc.path, tc.body, tc.hdrs)
			if errResp != nil {
				t.Fatalf("request failed: %v", errResp)
			}
			if raw.code != http.StatusBadRequest {
				t.Fatalf("status %d, want 400 (body %v)", raw.code, raw.body)
			}
			if raw.errCode() == "" {
				t.Fatalf("missing error code in body %v", raw.body)
			}
		})
	}

	// An unknown-but-well-formed warehouse is a 404, not a 400.
	unknown := createReservation(t, unknownUUID, []store.ReservationItem{{ProductID: prodA, Quantity: 1}}, "k-unknown-wh")
	if unknown.code != http.StatusNotFound || unknown.errCode() != "not_found" {
		t.Fatalf("unknown warehouse: status %d body %v", unknown.code, unknown.body)
	}

	// Nothing above may have created anything.
	if n := count(t, `SELECT count(*) FROM reservations`); n != 0 {
		t.Fatalf("reservations = %d, want 0", n)
	}
	if n := count(t, `SELECT count(*) FROM reservation_items`); n != 0 {
		t.Fatalf("reservation_items = %d, want 0", n)
	}
}

// TestInvalidStateTransitions: required test 11 — cancel after confirm and
// confirm after cancel are 409, repeats are idempotent, expired is terminal,
// unknown ids are 404.
func TestInvalidStateTransitions(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)

	// confirmed -> cancel conflicts; repeated confirm stays idempotent.
	a := mustCreate(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 1}}, "k-a")
	if r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/confirm", a), nil, nil); r.code != http.StatusOK {
		t.Fatalf("confirm a: status %d", r.code)
	}
	r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/cancel", a), nil, nil)
	if r.code != http.StatusConflict || r.errCode() != "invalid_transition" {
		t.Fatalf("cancel after confirm: status %d body %v", r.code, r.body)
	}
	if r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/confirm", a), nil, nil); r.code != http.StatusOK {
		t.Fatalf("repeat confirm: status %d body %v", r.code, r.body)
	}

	// cancelled -> confirm conflicts; repeated cancel stays idempotent.
	b := mustCreate(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 1}}, "k-b")
	if r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/cancel", b), nil, nil); r.code != http.StatusOK {
		t.Fatalf("cancel b: status %d", r.code)
	}
	r = call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/confirm", b), nil, nil)
	if r.code != http.StatusConflict || r.errCode() != "invalid_transition" {
		t.Fatalf("confirm after cancel: status %d body %v", r.code, r.body)
	}
	if r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/cancel", b), nil, nil); r.code != http.StatusOK {
		t.Fatalf("repeat cancel: status %d body %v", r.code, r.body)
	}

	// expired is terminal for both transitions.
	c := mustCreate(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 1}}, "k-c")
	expireNow(t, c)
	if r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/cancel", c), nil, nil); r.code != http.StatusConflict || r.errCode() != "reservation_expired" {
		t.Fatalf("cancel after expiry: status %d body %v", r.code, r.body)
	}
	if r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/confirm", c), nil, nil); r.code != http.StatusConflict {
		t.Fatalf("confirm after expiry: status %d body %v", r.code, r.body)
	}

	// Unknown reservation -> 404.
	if r := call(t, http.MethodPost, fmt.Sprintf("/reservations/%s/confirm", unknownUUID), nil, nil); r.code != http.StatusNotFound {
		t.Fatalf("unknown confirm: status %d body %v", r.code, r.body)
	}
	if r := call(t, http.MethodGet, fmt.Sprintf("/reservations/%s", unknownUUID), nil, nil); r.code != http.StatusNotFound {
		t.Fatalf("unknown get: status %d body %v", r.code, r.body)
	}
}

// TestAvailableStockAfterExpiration: required test 12 — expired holds stop
// reducing availability even though the stored status is still "pending",
// and the freed stock can be reserved again.
func TestAvailableStockAfterExpiration(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 10)
	id := mustCreate(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 10}}, "k-full")

	if _, res, avail := stockOf(t, testWarehouse, prodA); res != 10 || avail != 0 {
		t.Fatalf("while active: reserved=%d available=%d", res, avail)
	}

	expireNow(t, id)

	// Stored status stays pending; the effective view is what matters.
	var stored string
	if err := testStore.Pool.QueryRow(t.Context(),
		`SELECT status FROM reservations WHERE id = $1`, id).Scan(&stored); err != nil {
		t.Fatalf("read stored status: %v", err)
	}
	if stored != "pending" {
		t.Fatalf("stored status = %q, want pending (lazy expiration)", stored)
	}

	if _, res, avail := stockOf(t, testWarehouse, prodA); res != 0 || avail != 10 {
		t.Fatalf("after expiry: reserved=%d available=%d", res, avail)
	}

	// The freed stock can be reserved again in full.
	if got := createReservation(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 10}}, "k-again"); got.code != http.StatusCreated {
		t.Fatalf("re-reserve after expiry: status %d body %v", got.code, got.body)
	}
}

// TestCreateRollbackOnMissingProduct: required test 13 — a failure halfway
// through creation (unknown product in a second line) rolls back the whole
// transaction: no rows, no held stock, key still reusable. prodMissing sorts
// after prodA, so the first line is already locked when the second fails.
func TestCreateRollbackOnMissingProduct(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)

	r := createReservation(t, testWarehouse, []store.ReservationItem{
		{ProductID: prodA, Quantity: 1},
		{ProductID: prodMissing, Quantity: 1},
	}, "k-missing")
	if r.code != http.StatusNotFound || r.errCode() != "not_found" {
		t.Fatalf("create: status %d body %v", r.code, r.body)
	}

	if n := count(t, `SELECT count(*) FROM reservations`); n != 0 {
		t.Fatalf("reservations = %d, want 0", n)
	}
	if n := count(t, `SELECT count(*) FROM reservation_items`); n != 0 {
		t.Fatalf("reservation_items = %d, want 0", n)
	}
	if _, res, avail := stockOf(t, testWarehouse, prodA); res != 0 || avail != 100 {
		t.Fatalf("stock after rollback: reserved=%d available=%d", res, avail)
	}

	// Key remains usable after the failed attempt.
	if retry := createReservation(t, testWarehouse, []store.ReservationItem{{ProductID: prodA, Quantity: 1}}, "k-missing"); retry.code != http.StatusCreated {
		t.Fatalf("retry with same key: status %d body %v", retry.code, retry.body)
	}
}
