package api_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"depot/internal/store"
)

// awaitGroup waits for the goroutines with an upper bound, so a hypothetical
// hang fails the test instead of blocking the suite forever. The bound is a
// safety timeout, not a synchronization proof — correctness comes from the
// barrier below and from the database's own locking.
func awaitGroup(t *testing.T, wg *sync.WaitGroup, what string) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatalf("%s did not finish within 30s (possible hang)", what)
	}
}

// TestConcurrentSameIdempotencyKey: required test 8 — simultaneous requests
// carrying the same Idempotency-Key (as would happen across service instances)
// all receive the same reservation, and exactly one row exists afterwards.
// All goroutines are released together by closing the start channel, so the
// interleaving is created deterministically rather than by sleeping.
func TestConcurrentSameIdempotencyKey(t *testing.T) {
	reset(t)
	seedStock(t, testWarehouse, prodA, 100)

	raw, err := json.Marshal(map[string]any{
		"warehouse_id": testWarehouse,
		"items":        []store.ReservationItem{{ProductID: prodA, Quantity: 2}},
	})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	hdrs := map[string]string{
		"Content-Type":    "application/json",
		"Idempotency-Key": "same-key",
	}

	const attempts = 10
	start := make(chan struct{})
	results := make([]resp, attempts)
	errs := make([]error, attempts)

	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i], errs[i] = doRequest(http.MethodPost, "/reservations", string(raw), hdrs)
		}(i)
	}
	close(start)
	awaitGroup(t, &wg, "same-key requests")

	for i := 0; i < attempts; i++ {
		if errs[i] != nil {
			t.Fatalf("request %d failed: %v", i, errs[i])
		}
		if results[i].code != http.StatusCreated {
			t.Fatalf("request %d: status %d body %v", i, results[i].code, results[i].body)
		}
		if results[i].id() != results[0].id() {
			t.Fatalf("request %d returned id %s, want %s", i, results[i].id(), results[0].id())
		}
	}

	if n := count(t, `SELECT count(*) FROM reservations`); n != 1 {
		t.Fatalf("reservations = %d, want 1", n)
	}
	// Exactly one set of reservation items exists (one row for the single line).
	if n := count(t, `SELECT count(*) FROM reservation_items`); n != 1 {
		t.Fatalf("reservation_items = %d, want exactly 1 set", n)
	}
	// The stock hold is applied exactly once.
	if _, res, _ := stockOf(t, testWarehouse, prodA); res != 2 {
		t.Fatalf("reserved = %d, want 2", res)
	}
}

// TestConcurrentReservationsNeverOversell: required test 9 — ten simultaneous
// single-unit reservations compete for five units of stock. Because every
// creation locks the same stock row, the outcome is deterministic: exactly
// five succeed (201) and five are rejected (409), and the sums in the
// database add up. No in-memory lock is involved anywhere.
func TestConcurrentReservationsNeverOversell(t *testing.T) {
	reset(t)
	const physical = 5
	seedStock(t, testWarehouse, prodA, physical)

	const attempts = 10
	start := make(chan struct{})
	results := make([]resp, attempts)
	errs := make([]error, attempts)

	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body, err := json.Marshal(map[string]any{
				"warehouse_id": testWarehouse,
				"items":        []store.ReservationItem{{ProductID: prodA, Quantity: 1}},
			})
			if err != nil {
				errs[i] = err
				return
			}
			hdrs := map[string]string{
				"Content-Type":    "application/json",
				"Idempotency-Key": fmt.Sprintf("race-%d", i),
			}
			<-start
			results[i], errs[i] = doRequest(http.MethodPost, "/reservations", string(body), hdrs)
		}(i)
	}
	close(start)
	awaitGroup(t, &wg, "oversell race")

	created, conflicts := 0, 0
	for i := 0; i < attempts; i++ {
		if errs[i] != nil {
			t.Fatalf("request %d failed: %v", i, errs[i])
		}
		switch results[i].code {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
			if results[i].errCode() != "insufficient_stock" {
				t.Fatalf("request %d: conflict code %q, want insufficient_stock (body %v)",
					i, results[i].errCode(), results[i].body)
			}
		default:
			t.Fatalf("request %d: unexpected status %d body %v", i, results[i].code, results[i].body)
		}
	}

	if created != physical || conflicts != attempts-physical {
		t.Fatalf("created=%d conflicts=%d, want created=%d conflicts=%d (oversell!)",
			created, conflicts, physical, attempts-physical)
	}

	var reserved int64
	if err := testStore.Pool.QueryRow(t.Context(), `
		SELECT COALESCE(SUM(ri.quantity), 0)
		FROM reservation_items ri
		JOIN reservations r ON r.id = ri.reservation_id
		WHERE r.warehouse_id = $1 AND ri.product_id = $2
		  AND r.status = 'pending' AND r.expires_at > now()`,
		testWarehouse, prodA,
	).Scan(&reserved); err != nil {
		t.Fatalf("sum reserved: %v", err)
	}
	if reserved != physical {
		t.Fatalf("total reserved = %d, want %d", reserved, physical)
	}
	if p, res, avail := stockOf(t, testWarehouse, prodA); p != physical || res != physical || avail != 0 {
		t.Fatalf("stock: physical=%d reserved=%d available=%d", p, res, avail)
	}
}

// TestConcurrentOversizedReservations is the scenario from the assignment:
// 5 units in stock, two simultaneous reservations of 4 units each. Because
// both creators must lock the same stock row, at most one can succeed:
// - exactly one 201 and one documented 409,
// - total reserved never exceeds 5 (it is exactly 4),
// - physical stock never goes negative,
// - the losing request leaves no partial reservation items behind.
// Each request runs on its own connection through the shared pool, so these
// are genuinely concurrent PostgreSQL transactions coordinated by a start
// barrier — no sleeps are involved.
func TestConcurrentOversizedReservations(t *testing.T) {
	reset(t)
	const physical = 5
	seedStock(t, testWarehouse, prodA, physical)

	const (
		requestUnits = 4
		attemptCount = 2
	)
	start := make(chan struct{})
	results := make([]resp, attemptCount)
	errs := make([]error, attemptCount)

	var wg sync.WaitGroup
	for i := 0; i < attemptCount; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body, err := json.Marshal(map[string]any{
				"warehouse_id": testWarehouse,
				"items":        []store.ReservationItem{{ProductID: prodA, Quantity: requestUnits}},
			})
			if err != nil {
				errs[i] = err
				return
			}
			hdrs := map[string]string{
				"Content-Type":    "application/json",
				"Idempotency-Key": fmt.Sprintf("big-race-%d", i),
			}
			<-start
			results[i], errs[i] = doRequest(http.MethodPost, "/reservations", string(body), hdrs)
		}(i)
	}
	close(start)
	awaitGroup(t, &wg, "oversized reservations")

	created, conflicts := 0, 0
	for i := 0; i < attemptCount; i++ {
		if errs[i] != nil {
			t.Fatalf("request %d failed: %v", i, errs[i])
		}
		switch results[i].code {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
			if results[i].errCode() != "insufficient_stock" {
				t.Fatalf("request %d: code %q, want insufficient_stock (body %v)",
					i, results[i].errCode(), results[i].body)
			}
		default:
			t.Fatalf("request %d: unexpected status %d body %v", i, results[i].code, results[i].body)
		}
	}

	if created != 1 || conflicts != 1 {
		t.Fatalf("created=%d conflicts=%d, want exactly 1 success and 1 conflict", created, conflicts)
	}

	// Database invariants: reserved never exceeds physical, physical stays
	// non-negative, and the loser left no partial rows.
	if n := count(t, `SELECT count(*) FROM reservations`); n != 1 {
		t.Fatalf("reservations = %d, want 1", n)
	}
	if n := count(t, `SELECT count(*) FROM reservation_items`); n != 1 {
		t.Fatalf("reservation_items = %d, want 1 (no partial items from the loser)", n)
	}
	var reserved int64
	if err := testStore.Pool.QueryRow(t.Context(), `
		SELECT COALESCE(SUM(ri.quantity), 0)
		FROM reservation_items ri
		JOIN reservations r ON r.id = ri.reservation_id
		WHERE r.warehouse_id = $1 AND ri.product_id = $2
		  AND r.status = 'pending' AND r.expires_at > now()`,
		testWarehouse, prodA,
	).Scan(&reserved); err != nil {
		t.Fatalf("sum reserved: %v", err)
	}
	if reserved > physical {
		t.Fatalf("reserved = %d exceeds physical stock %d (oversell)", reserved, physical)
	}
	if reserved != requestUnits {
		t.Fatalf("reserved = %d, want %d", reserved, requestUnits)
	}
	p, res, avail := stockOf(t, testWarehouse, prodA)
	if p != physical || p < 0 || res < 0 || avail < 0 {
		t.Fatalf("stock must never go negative: physical=%d reserved=%d available=%d", p, res, avail)
	}
}
