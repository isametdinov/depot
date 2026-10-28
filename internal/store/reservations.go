package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Reservation states.
const (
	StatusPending   = "pending"
	StatusConfirmed = "confirmed"
	StatusCancelled = "cancelled"
	StatusExpired   = "expired" // derived from expires_at (see README), never written by design
)

// Input bounds treated as invalid by the API layer.
const (
	MaxItemsPerReservation = 100
	MaxQuantity            = 1_000_000
)

// ReservationItem is one held line of a reservation.
type ReservationItem struct {
	ProductID string `json:"product_id"`
	Quantity  int64  `json:"quantity"`
}

// Reservation is the API-facing view of a reservation. Status is the
// *effective* status: a pending row past expires_at reports "expired".
type Reservation struct {
	ID          string            `json:"id"`
	WarehouseID string            `json:"warehouse_id"`
	Status      string            `json:"status"`
	ExpiresAt   time.Time         `json:"expires_at"`
	CreatedAt   time.Time         `json:"created_at"`
	Items       []ReservationItem `json:"items"`
}

// CreateReservationInput is a validated creation request. Items are non-empty,
// positive and unique by product id; the caller validates.
type CreateReservationInput struct {
	WarehouseID    string
	Items          []ReservationItem
	IdempotencyKey string
}

// Fingerprint builds a deterministic request fingerprint from the normalized
// (lower-cased) warehouse id and items sorted by product id, then SHA-256. It
// never depends on JSON field ordering or map iteration, so reordering the
// request body cannot change the fingerprint.
func Fingerprint(warehouseID string, items []ReservationItem) string {
	normalize := func(id string) string { return strings.ToLower(id) }

	sorted := append([]ReservationItem(nil), items...)
	for i := range sorted {
		sorted[i].ProductID = normalize(sorted[i].ProductID)
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ProductID < sorted[j].ProductID })

	h := sha256.New()
	fmt.Fprintf(h, "warehouse:%s\n", normalize(warehouseID))
	for _, it := range sorted {
		fmt.Fprintf(h, "product:%s:quantity:%d\n", it.ProductID, it.Quantity)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// CreateReservation atomically claims the idempotency key (an INSERT into the
// unique reservations.idempotency_key), reserves every requested item or
// none, and stores everything in one transaction. Returns the reservation and
// whether it was a replay of an earlier request with the same key.
func (s *Store) CreateReservation(ctx context.Context, in CreateReservationInput) (*Reservation, bool, error) {
	fp := Fingerprint(in.WarehouseID, in.Items)
	// One retry covers the vanishingly rare case where the competing
	// transaction rolled back between our failed key insert and our read.
	for attempt := 0; attempt < 2; attempt++ {
		res, replayed, err := s.tryCreateReservation(ctx, in, fp)
		if errors.Is(err, errIdempotencyRetry) {
			continue
		}
		return res, replayed, err
	}
	return nil, false, fmt.Errorf("give up after idempotency race: %w", errIdempotencyRetry)
}

func (s *Store) tryCreateReservation(ctx context.Context, in CreateReservationInput, fp string) (*Reservation, bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after commit

	// 1) Claim the idempotency key by inserting the reservation row first.
	// Concurrent requests with the same key block here on the unique index
	// until the first transaction commits or rolls back, which makes same-key
	// behaviour safe across service instances. An unknown warehouse fails
	// this insert on its foreign key (mapped to 404 below).
	var res Reservation
	err = tx.QueryRow(ctx, `
		INSERT INTO reservations (warehouse_id, status, idempotency_key, request_fingerprint, expires_at)
		VALUES ($1, 'pending', $2, $3, now() + interval '15 minutes')
		RETURNING id, warehouse_id, status, expires_at, created_at`,
		in.WarehouseID, in.IdempotencyKey, fp,
	).Scan(&res.ID, &res.WarehouseID, &res.Status, &res.ExpiresAt, &res.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			tx.Rollback(ctx)
			return s.replayReservation(ctx, in.IdempotencyKey, fp)
		}
		if isForeignKeyViolation(err) {
			return nil, false, fmt.Errorf("warehouse %s: %w", in.WarehouseID, ErrNotFound)
		}
		return nil, false, fmt.Errorf("insert reservation: %w", err)
	}

	// 2) Lock the stock rows in a consistent product_id order so concurrent
	// multi-product reservations cannot deadlock. FOR UPDATE serializes all
	// creators of the same stock row, which is what prevents overselling.
	sorted := append([]ReservationItem(nil), in.Items...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ProductID < sorted[j].ProductID })

	physical := make(map[string]int64, len(sorted))
	for _, it := range sorted {
		var qty int64
		err := tx.QueryRow(ctx, `
			SELECT physical_quantity
			FROM stock
			WHERE warehouse_id = $1 AND product_id = $2
			FOR UPDATE`,
			in.WarehouseID, it.ProductID,
		).Scan(&qty)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, fmt.Errorf("product %s has no stock row in warehouse %s: %w",
				it.ProductID, in.WarehouseID, ErrNotFound)
		}
		if err != nil {
			return nil, false, fmt.Errorf("lock stock row: %w", err)
		}
		physical[it.ProductID] = qty
	}

	// 3) Availability check with the database clock, inside the same
	// transaction. Insufficient stock aborts everything (deferred rollback,
	// which also releases the claimed idempotency key).
	for _, it := range sorted {
		reserved, err := reservedStock(ctx, tx, in.WarehouseID, it.ProductID)
		if err != nil {
			return nil, false, err
		}
		available := physical[it.ProductID] - reserved
		if available < it.Quantity {
			return nil, false, fmt.Errorf("product %s has available %d, requested %d: %w",
				it.ProductID, available, it.Quantity, ErrInsufficientStock)
		}
	}

	// 4) Insert every reservation item.
	for _, it := range sorted {
		if _, err := tx.Exec(ctx, `
			INSERT INTO reservation_items (reservation_id, product_id, quantity)
			VALUES ($1, $2, $3)`,
			res.ID, it.ProductID, it.Quantity,
		); err != nil {
			if isForeignKeyViolation(err) {
				return nil, false, fmt.Errorf("product %s: %w", it.ProductID, ErrNotFound)
			}
			return nil, false, fmt.Errorf("insert reservation item: %w", err)
		}
	}
	res.Items = sorted

	// 5) Commit: reservation, items and the claimed key become visible
	// together or not at all.
	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("commit: %w", err)
	}
	return &res, false, nil
}

// replayReservation answers a request whose key was already claimed: same
// fingerprint returns the original reservation, different fingerprint is a
// 409 conflict.
func (s *Store) replayReservation(ctx context.Context, key, fp string) (*Reservation, bool, error) {
	var storedFP string
	var resID string
	err := s.Pool.QueryRow(ctx, `
		SELECT request_fingerprint, id
		FROM reservations
		WHERE idempotency_key = $1`, key,
	).Scan(&storedFP, &resID)
	if errors.Is(err, pgx.ErrNoRows) {
		// The competing transaction rolled back between our failed insert and
		// this read; the key is free again.
		return nil, false, errIdempotencyRetry
	}
	if err != nil {
		return nil, false, fmt.Errorf("read idempotency record: %w", err)
	}
	if storedFP != fp {
		return nil, false, fmt.Errorf("key %q: %w", key, ErrIdempotencyConflict)
	}
	res, err := s.GetReservation(ctx, resID)
	if err != nil {
		return nil, false, fmt.Errorf("load original reservation: %w", err)
	}
	return res, true, nil
}

// GetReservation loads one reservation with its effective status: a pending
// row past expires_at reports "expired" even though the stored status is
// still "pending".
func (s *Store) GetReservation(ctx context.Context, id string) (*Reservation, error) {
	return getReservation(ctx, s.Pool, id)
}

func getReservation(ctx context.Context, q Querier, id string) (*Reservation, error) {
	var r Reservation
	err := q.QueryRow(ctx, `
		SELECT id, warehouse_id,
		       CASE WHEN status = 'pending' AND expires_at <= now()
		            THEN 'expired' ELSE status END,
		       expires_at, created_at
		FROM reservations
		WHERE id = $1`, id,
	).Scan(&r.ID, &r.WarehouseID, &r.Status, &r.ExpiresAt, &r.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("reservation %s: %w", id, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("read reservation: %w", err)
	}

	rows, err := q.Query(ctx, `
		SELECT product_id, quantity
		FROM reservation_items
		WHERE reservation_id = $1
		ORDER BY product_id`, id,
	)
	if err != nil {
		return nil, fmt.Errorf("read reservation items: %w", err)
	}
	defer rows.Close()

	r.Items = []ReservationItem{}
	for rows.Next() {
		var it ReservationItem
		if err := rows.Scan(&it.ProductID, &it.Quantity); err != nil {
			return nil, fmt.Errorf("scan reservation item: %w", err)
		}
		r.Items = append(r.Items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate reservation items: %w", err)
	}
	return &r, nil
}

// ConfirmReservation moves a pending, unexpired reservation to confirmed.
// Confirming an already confirmed reservation returns the same result
// (idempotent); cancelled or expired reservations conflict (409).
func (s *Store) ConfirmReservation(ctx context.Context, id string) (*Reservation, error) {
	return s.transition(ctx, id, StatusConfirmed)
}

// CancelReservation moves a pending, unexpired reservation to cancelled and
// thereby releases its hold. Cancelling an already cancelled reservation
// returns the same result (idempotent); confirmed or expired reservations
// conflict (409).
func (s *Store) CancelReservation(ctx context.Context, id string) (*Reservation, error) {
	return s.transition(ctx, id, StatusCancelled)
}

// transition performs the state change atomically with a single conditional
// UPDATE (which also serializes concurrent transitions on the same row) and
// resolves the no-match case against the current effective state.
func (s *Store) transition(ctx context.Context, id string, target string) (*Reservation, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after commit

	var updated string
	err = tx.QueryRow(ctx, `
		UPDATE reservations
		SET status = $2, updated_at = now()
		WHERE id = $1 AND status = 'pending' AND expires_at > now()
		RETURNING id`,
		id, target,
	).Scan(&updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.resolveMissedTransition(ctx, tx, id, target)
	}
	if err != nil {
		return nil, fmt.Errorf("update reservation status: %w", err)
	}

	res, err := getReservation(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return res, nil
}

// resolveMissedTransition interprets a conditional UPDATE that matched no row.
// Under READ COMMITTED the re-evaluated row already contains any concurrent
// transition, so this read cannot race with it.
func (s *Store) resolveMissedTransition(ctx context.Context, tx pgx.Tx, id string, target string) (*Reservation, error) {
	res, err := getReservation(ctx, tx, id)
	if err != nil {
		return nil, err // ErrNotFound or a real error
	}
	switch {
	case res.Status == target:
		// Already in the requested terminal state: idempotent success.
		return res, nil
	case res.Status == StatusExpired:
		// getReservation derives "expired" from the database clock; a pending
		// row past expires_at can never pass the UPDATE guard.
		return nil, fmt.Errorf("reservation %s: %w", id, ErrReservationExpired)
	default:
		return nil, fmt.Errorf("reservation %s is %s, cannot move to %s: %w",
			id, res.Status, target, ErrInvalidTransition)
	}
}
