# REVIEW.md — Code Review: `Reserve()`

Reviewed function (as given in the assignment):

```go
func Reserve(ctx context.Context, db *sql.DB, productID int64, qty int) error {
    var available int

    err := db.QueryRowContext(
        ctx,
        `SELECT quantity FROM stock WHERE product_id = $1`,
        productID,
    ).Scan(&available)
    if err != nil {
        return err
    }

    if available < qty {
        return errors.New("not enough stock")
    }

    _, err = db.ExecContext(
        ctx,
        `UPDATE stock SET quantity = quantity - $1 WHERE product_id = $2`,
        qty,
        productID,
    )
    return err
}
```

## Summary

The function is unsafe for a production reservation workflow because it is a
**check-then-act race**: availability is read in one statement and the
deduction applied in a second, with no transaction and no row lock in between.
Two concurrent calls can both read `available = 5`, both pass the check, and
both deduct — overselling stock and driving the quantity negative. Beyond the
race, the function models the *wrong business operation*: it permanently
subtracts from a raw stock number instead of creating a hold (a reservation)
against **available** stock in a **specific warehouse**, it accepts zero and
negative quantities (a negative `qty` silently *increases* stock — an
easy exploit), it has no idempotency so a retried request double-deducts, and
its flat `errors.New("not enough stock")` gives the HTTP layer nothing to
distinguish a `409` from a `500`. The defects fall into two distinct groups:
**business-rule defects** (what the operation means) and **implementation
defects** (how it is computed) — conflating them is exactly how a "quick fix"
ends up still wrong.

## Business-rule concerns

- **Zero and negative quantities.** Nothing validates `qty`. `qty == 0` is a
  no-op that reports success; `qty < 0` *adds* stock through the back door.
  The rule must be `qty >= 1`, enforced at the API boundary **and** by a
  database `CHECK (quantity > 0)` so no code path can bypass it.
- **Physical stock vs available stock.** `quantity` in a stock table is
  *physical* stock. Availability is a derived value:
  `available = physical − (sum of pending, unexpired reservations)`. This
  function checks against (and deducts from) a single undifferentiated number,
  so it cannot express what "available" means once reservations exist.
- **Reserve vs permanently deduct.** The `UPDATE … quantity - $1` is a
  permanent physical deduction, i.e. fulfillment — but the workflow is a
  *reservation*. The correct model is: create a reservation row that **holds**
  stock (physical quantity untouched; availability drops because the derived
  sum grows), and only a later fulfillment step (out of scope here) should
  deduct physically. As written, cancelling or expiring the reservation could
  not restore stock because no hold was ever recorded.
- **Missing warehouse scope.** In this project's schema, stock is keyed by
  `(warehouse_id, product_id)`. A `productID`-only signature cannot say *which*
  warehouse's stock to check — it either targets an ambiguous row or the wrong
  one entirely. Any corrected signature needs the warehouse.
- **Single product vs multi-item atomicity.** The assignment requires
  all-or-nothing multi-item reservations. A single-product helper invites a
  caller loop (`for _, item := range items { Reserve(...) }`) that is *not*
  atomic: item 2 can fail after item 1 succeeded, leaving a partial
  reservation. Multi-item reservation must live inside one transaction.
- **Expiration and reservation state affect availability.** Availability
  shrinks only for reservations that are `pending` **and** `expires_at > now()`;
  `confirmed`, `cancelled` and `expired` hold nothing, and expiry must be
  judged by the **database clock** (a Go server clock would drift and race).
  A bare stock-row counter cannot represent any of this — which is precisely
  why availability must be computed from the reservations, not stored twice.
- **Assumptions that need a product owner's confirmation:**
  1. Does *confirming* release the stock hold (the assignment says yes), or
     should a confirmed reservation keep holding until fulfillment?
  2. Is a fixed 15-minute TTL acceptable, and should it be per-request?
  3. May physical stock ever be lowered below what is currently reserved?
     (We reject that with `409 stock_below_reserved`.)
  4. Idempotency-key retention window and scope (global vs per-client).
  5. Is `expired` terminal for cancellation too (we treat it as terminal)?

## Implementation concerns

- **Race condition between `SELECT` and `UPDATE`.** With default `READ
  COMMITTED` and no transaction, the window between the two statements lets a
  concurrent request commit a deduction first; the second request's check is
  already stale. Both succeed → oversell. Fix: do the read **inside a
  transaction with `SELECT … FOR UPDATE`** so creators serialize on the row
  (or use one conditional atomic `UPDATE … WHERE quantity >= $1`, which must
  also verify the *derived* availability, not just physical).
- **Overselling under concurrency.** Direct consequence of the race; in this
  codebase it is prevented by locking every `stock` row (`FOR UPDATE`) in
  consistent product-id order *before* computing availability, inside one
  transaction — verified by real-PostgreSQL tests (see *How to prove it*).
- **Missing transaction and atomicity.** Even if the read were locked, the
  lock would be released at statement end without a surrounding transaction.
  Every multi-statement reservation step must share one `BeginTx`/`Commit`
  with rollback on any error.
- **Missing database-level guard against negative quantities.** The `UPDATE`
  unconditionally subtracts. A `CHECK (physical_quantity >= 0)` on the table
  turns any residual bug into a fast, loud constraint error instead of silent
  corruption (defense in depth beneath the application check).
- **Handling of missing stock rows.** `QueryRow…Scan` returns
  `sql.ErrNoRows`, which the code forwards verbatim → a client typo becomes a
  `500` instead of a `404`. Worse, if the row is missing, the `UPDATE` simply
  affects zero rows and returns `nil` — reporting **success for a no-op**.
  Handle `ErrNoRows` as "not found" and check `RowsAffected`.
- **Error classification and HTTP mapping.** `errors.New("not enough stock")`
  is an opaque string; the handler cannot tell it from a network failure.
  Business outcomes need sentinel/typed errors
  (`ErrInsufficientStock → 409`, `ErrNotFound → 404`, validation → `400`) and
  raw driver errors must never reach the client (log them, return a generic
  `500`).
- **Context cancellation and database errors.** `ctx` errors
  (`context.Canceled` / `DeadlineExceeded`) should be recognized as client
  disconnects/timeouts, not logged as server faults; the transaction must roll
  back on any error path (deferred rollback) so a cancelled request leaves no
  half-written rows.
- **Does `productID` alone uniquely identify a stock row?** No. The primary
  key is `(warehouse_id, product_id)`, so the same product has one row *per
  warehouse*; `WHERE product_id = $1` would match several rows (or none), and
  `QueryRow` would arbitrarily take one. The function's identifier set is
  fundamentally incomplete.
- **Missing idempotency.** Reservation creation arrives over HTTP where
  retries happen. Without a persisted `Idempotency-Key` (unique, claimed in
  the same transaction), a client that times out and retries silently
  double-reserves. The key must be written **atomically** with the reservation
  so a rolled-back attempt leaves the key reusable.

**Business-rule vs implementation defects.** The business-rule group —
quantity semantics, physical vs available, reserve-vs-deduct, warehouse scope,
multi-item atomicity, expiry/state interplay — defines *what correct means* and
cannot be fixed by any amount of locking; each needs product-owner agreement
before code is written. The implementation group — the read/act race, missing
transaction, absent `CHECK`, unhandled `ErrNoRows`, unclassifiable errors,
context handling, incomplete key set, missing idempotency — defines *whether
the agreed rule is computed reliably*. A fix must address both: correcting
only the race would still permanently deduct stock, and correcting only the
business model with the same two-statement pattern would still oversell.

## Corrected implementation

The corrected version of *this function's shape* — transaction, row lock,
validation, classification (single product, for illustration):

```go
var (
    ErrInsufficientStock = errors.New("insufficient stock")
    ErrStockNotFound     = errors.New("stock row not found")
    ErrInvalidQuantity   = errors.New("quantity must be a positive integer")
)

func Reserve(ctx context.Context, db *sql.DB, warehouseID, productID int64, qty int) error {
    if qty < 1 {
        return fmt.Errorf("qty=%d: %w", qty, ErrInvalidQuantity) // → 400
    }

    tx, err := db.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer tx.Rollback() // no-op once Commit succeeds

    // 1. Lock the stock row FOR UPDATE: concurrent creators now serialize in
    //    the database (works across processes/instances, no in-memory mutex).
    // 2. Compute *available* stock (physical minus pending, unexpired holds)
    //    with the database clock, in the same transaction.
    var physical int
    err = tx.QueryRowContext(ctx, `
        SELECT physical_quantity
        FROM stock
        WHERE warehouse_id = $1 AND product_id = $2
        FOR UPDATE`,
        warehouseID, productID,
    ).Scan(&physical)
    if errors.Is(err, sql.ErrNoRows) {
        return ErrStockNotFound // → 404
    }
    if err != nil {
        return err
    }

    var held int
    err = tx.QueryRowContext(ctx, `
        SELECT COALESCE(SUM(ri.quantity), 0)
        FROM reservation_items ri
        JOIN reservations r ON r.id = ri.reservation_id
        WHERE r.warehouse_id = $1 AND ri.product_id = $2
          AND r.status = 'pending' AND r.expires_at > now()`,
        warehouseID, productID,
    ).Scan(&held)
    if err != nil {
        return err
    }

    if physical-held < qty {
        return ErrInsufficientStock // → 409
    }

    // ... create reservation + item rows for ALL requested products here ...

    return tx.Commit()
}
```

And as a **belt-and-braces second line of defense** (with the table's
constraints):

```sql
ALTER TABLE stock ADD CHECK (physical_quantity >= 0);
```

**In this repository** the real implementation already follows this design in
its full multi-item form — `internal/store/reservations.go`
(`tryCreateReservation`): claims the idempotency key first, locks every stock
row in sorted product-id order, checks availability, inserts the reservation
and all items, and commits once; state transitions use a single conditional
`UPDATE` (see `transition`). The corrected sketch above is the teaching-sized
version of that code, not a replacement for it.

## How I would prove the correction works

Proof must come from **real PostgreSQL**, not mocks or sleeps:

1. **Unit tests (no DB):** `qty = 0`, negative, and oversized quantities are
   rejected; each error class maps to its HTTP status (`400`/`404`/`409`)
   with a stable JSON error shape, and unexpected errors return a generic `500`
   that leaks no SQL.
   *Implemented:* `internal/api/unit_test.go` (`TestValidateCreateRequest`,
   `TestWriteStoreErrorMapping`).
2. **Happy-path integration:** create → stock row shows the hold; SQL asserts
   the stored row (`status`, `expires_at − created_at = 15 min`, item rows),
   not just the HTTP body.
   *Implemented:* `TestCreateValidMultiItemReservation`.
3. **Rollback proof:** a multi-item request where one product lacks stock (or
   is missing) returns `409`/`404` and SQL proves **zero** reservation rows,
   **zero** item rows, unchanged stock, and that the idempotency key is still
   usable afterwards.
   *Implemented:* `TestCreateRollsBackWhenOneItemLacksStock`,
   `TestCreateRollbackOnMissingProduct`.
4. **Concurrency proof (the regression test for the original race):** stock =
   5; two simultaneous requests for 4 units, released together by a start
   barrier on separate pool connections. Expected: exactly one `201`, one
   `409 insufficient_stock`, `SUM(reserved) = 4 ≤ 5`, physical stock never
   negative, and no partial rows from the loser. A ten-way 1-unit race
   additionally asserts exactly 5 successes.
   *Implemented:* `TestConcurrentOversizedReservations`,
   `TestConcurrentReservationsNeverOversell` — both pass against real
   PostgreSQL; run with `go test -race` where `gcc` exists.
5. **Constraint proof:** direct SQL inserting a negative quantity or a
   zero-quantity item must fail with a constraint violation (the `CHECK`s),
   proving the database — not just the application — guards the invariants.
6. **Idempotency proof:** same key + same payload twice → one reservation and
   one item set (SQL count), identical response id; same key + different
   payload → `409`; ten simultaneous same-key requests → one row.
   *Implemented:* `TestIdempotentReplay`, `TestIdempotencyKeyDifferentRequest`,
   `TestConcurrentSameIdempotencyKey`.
7. **Expiration proof:** move `expires_at` into the past with SQL (real
   database clock comparison, no 15-minute wait, no production-code change),
   then assert availability is restored, confirm returns `409`, and retrieval
   reports `expired` while the stored status stays `pending`.
   *Implemented:* `TestConfirmAfterExpirationRejected`,
   `TestAvailableStockAfterExpiration`.

Together these demonstrate the corrected invariants end-to-end: *no
configuration of concurrent requests can make physical or available stock go
negative, and a failed reservation leaves no state behind.*
