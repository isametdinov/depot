package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Stock is the stock picture of one product in one warehouse.
type Stock struct {
	WarehouseID    string `json:"warehouse_id"`
	ProductID      string `json:"product_id"`
	PhysicalStock  int64  `json:"physical_stock"`
	ReservedStock  int64  `json:"reserved_stock"`
	AvailableStock int64  `json:"available_stock"`
}

// reservedStock sums the quantities held by pending, unexpired reservations
// for one product in one warehouse:
//
//	available = physical_quantity - active_unexpired_reserved
//
// Expired, confirmed and cancelled reservations never hold stock — the
// expiration check uses the database clock, so a stale stored "pending" status
// past expires_at does not reduce availability. There is exactly one stock
// representation: the stock row plus this derived sum.
func reservedStock(ctx context.Context, q Querier, warehouseID, productID string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(ri.quantity), 0)
		FROM reservation_items ri
		JOIN reservations r ON r.id = ri.reservation_id
		WHERE r.warehouse_id = $1
		  AND ri.product_id = $2
		  AND r.status = 'pending'
		  AND r.expires_at > now()`,
		warehouseID, productID,
	).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("sum reserved stock: %w", err)
	}
	return n, nil
}

// SetStock sets the physical stock of a product in a warehouse, creating the
// warehouse/product/stock rows when missing (this endpoint is how stock gets
// seeded; the assignment defines no separate catalog endpoint). Existing
// warehouse and product rows are never overwritten. The upsert locks the stock
// row, and the new value is rejected if it would fall below what pending,
// unexpired reservations already hold, so available stock can never go
// negative.
func (s *Store) SetStock(ctx context.Context, warehouseID, productID string, quantity int64) (*Stock, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after commit

	if _, err := tx.Exec(ctx, `
		INSERT INTO warehouses (id, name)
		VALUES ($1::uuid, 'warehouse-' || $1::uuid::text)
		ON CONFLICT (id) DO NOTHING`,
		warehouseID,
	); err != nil {
		return nil, fmt.Errorf("ensure warehouse: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO products (id, sku, name)
		VALUES ($1::uuid, $1::uuid::text, 'product-' || $1::uuid::text)
		ON CONFLICT (id) DO NOTHING`,
		productID,
	); err != nil {
		return nil, fmt.Errorf("ensure product: %w", err)
	}

	var physical int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO stock (warehouse_id, product_id, physical_quantity)
		VALUES ($1, $2, $3)
		ON CONFLICT (warehouse_id, product_id)
		DO UPDATE SET physical_quantity = EXCLUDED.physical_quantity,
		              updated_at = now()
		RETURNING physical_quantity`,
		warehouseID, productID, quantity,
	).Scan(&physical); err != nil {
		return nil, fmt.Errorf("upsert stock: %w", err)
	}

	reserved, err := reservedStock(ctx, tx, warehouseID, productID)
	if err != nil {
		return nil, err
	}
	if physical < reserved {
		return nil, fmt.Errorf("physical %d is below reserved %d: %w", physical, reserved, ErrStockBelowReserved)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return &Stock{
		WarehouseID:    warehouseID,
		ProductID:      productID,
		PhysicalStock:  physical,
		ReservedStock:  reserved,
		AvailableStock: physical - reserved,
	}, nil
}

// GetStock returns the current stock picture for one product in one warehouse.
func (s *Store) GetStock(ctx context.Context, warehouseID, productID string) (*Stock, error) {
	var physical, reserved int64
	err := s.Pool.QueryRow(ctx, `
		SELECT s.physical_quantity,
		       COALESCE((
		           SELECT SUM(ri.quantity)
		           FROM reservation_items ri
		           JOIN reservations r ON r.id = ri.reservation_id
		           WHERE r.warehouse_id = s.warehouse_id
		             AND ri.product_id = s.product_id
		             AND r.status = 'pending'
		             AND r.expires_at > now()
		       ), 0)
		FROM stock s
		WHERE s.warehouse_id = $1 AND s.product_id = $2`,
		warehouseID, productID,
	).Scan(&physical, &reserved)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("warehouse %s / product %s: %w", warehouseID, productID, ErrNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("read stock: %w", err)
	}
	return &Stock{
		WarehouseID:    warehouseID,
		ProductID:      productID,
		PhysicalStock:  physical,
		ReservedStock:  reserved,
		AvailableStock: physical - reserved,
	}, nil
}
