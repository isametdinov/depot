// Package store implements the DEPOT data layer: stock, reservations and
// idempotency. Every business-critical operation runs inside a PostgreSQL
// transaction.
package store

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors mapped to HTTP responses by the API layer.
var (
	ErrNotFound            = errors.New("not found")
	ErrInsufficientStock   = errors.New("insufficient stock")
	ErrIdempotencyConflict = errors.New("idempotency key already used with a different request")
	ErrInvalidTransition   = errors.New("invalid state transition")
	ErrReservationExpired  = errors.New("reservation is expired")
	ErrStockBelowReserved  = errors.New("physical stock cannot be set below the reserved quantity")
)

// errIdempotencyRetry is a private retry signal: the idempotency key conflicted
// but the competing transaction disappeared before we could read its record.
var errIdempotencyRetry = errors.New("idempotency record unavailable, retry")

// Querier is satisfied by both *pgxpool.Pool and pgx.Tx, so query helpers can
// run inside or outside a transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Store is the data-access entry point. Pool is exported so tests can reset
// data between cases.
type Store struct {
	Pool *pgxpool.Pool
}

// New connects to PostgreSQL and verifies the connection.
func New(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to database: %w", err)
	}
	return &Store{Pool: pool}, nil
}

// Close releases all connections.
func (s *Store) Close() { s.Pool.Close() }

// ApplyMigrations applies every embedded *.sql file in filename order, each in
// its own transaction. The files are written to be idempotent (IF NOT
// EXISTS), so this is safe to run on every start.
func (s *Store) ApplyMigrations(ctx context.Context, fsys fs.FS) error {
	names, err := fs.Glob(fsys, "*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Strings(names)
	for _, name := range names {
		body, err := fs.ReadFile(fsys, name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}
	return nil
}

// isUniqueViolation reports whether err is a PostgreSQL unique-constraint
// violation (SQLSTATE 23505).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// isForeignKeyViolation reports whether err is a PostgreSQL foreign-key
// violation (SQLSTATE 23503), e.g. an unknown warehouse or product id.
func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
