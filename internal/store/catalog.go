package store

import (
	"context"
	"fmt"
)

type Warehouse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Product struct {
	ID   string `json:"id"`
	SKU  string `json:"sku"`
	Name string `json:"name"`
}

func (s *Store) ListWarehouses(ctx context.Context) ([]Warehouse, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, name
		FROM warehouses
		ORDER BY name, id`)
	if err != nil {
		return nil, fmt.Errorf("list warehouses: %w", err)
	}
	defer rows.Close()

	warehouses := make([]Warehouse, 0)
	for rows.Next() {
		var warehouse Warehouse
		if err := rows.Scan(&warehouse.ID, &warehouse.Name); err != nil {
			return nil, fmt.Errorf("scan warehouse: %w", err)
		}
		warehouses = append(warehouses, warehouse)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate warehouses: %w", err)
	}
	return warehouses, nil
}

func (s *Store) ListProducts(ctx context.Context) ([]Product, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, sku, name
		FROM products
		ORDER BY name, id`)
	if err != nil {
		return nil, fmt.Errorf("list products: %w", err)
	}
	defer rows.Close()

	products := make([]Product, 0)
	for rows.Next() {
		var product Product
		if err := rows.Scan(&product.ID, &product.SKU, &product.Name); err != nil {
			return nil, fmt.Errorf("scan product: %w", err)
		}
		products = append(products, product)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate products: %w", err)
	}
	return products, nil
}
