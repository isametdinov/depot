-- DEPOT baseline schema.
--
-- This file MIRRORS the schema that already exists in the DEPOT database
-- (created by the project's original migrations 0001-0005, see the
-- schema_migrations table), so that a fresh database used by the test suite
-- is identical to production. Every statement is guarded with IF NOT EXISTS:
-- running this against the existing DEPOT database is a complete no-op and
-- never drops or alters existing data.
--
-- Inspection result (Task 2): the existing schema already provides everything
-- the assignment requires — unique idempotency key, request fingerprint,
-- expiration timestamp, valid-status and positive-quantity constraints,
-- non-negative stock and all foreign keys — so NO schema changes were needed.
--
-- Future migrations for this project should be numbered 0006+ to stay clear
-- of the original ledger in schema_migrations.

CREATE TABLE IF NOT EXISTS warehouses (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL CHECK (btrim(name) <> ''),
    location   text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku         text NOT NULL UNIQUE CHECK (btrim(sku) <> ''),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    description text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Physical stock per product per warehouse. physical_quantity >= 0 is
-- enforced by the table, and the primary key is the row that reservation
-- creation locks with SELECT ... FOR UPDATE.
CREATE TABLE IF NOT EXISTS stock (
    warehouse_id      uuid NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
    product_id        uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    physical_quantity integer NOT NULL DEFAULT 0 CHECK (physical_quantity >= 0),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (warehouse_id, product_id)
);

CREATE TABLE IF NOT EXISTS reservations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id        uuid NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
    -- Unique idempotency key for POST /reservations (nullable: only the
    -- creation endpoint sets it). NULLs are allowed so non-idempotent
    -- internal writes stay possible.
    idempotency_key     text UNIQUE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    -- Expiration is always compared against the database clock.
    expires_at          timestamptz NOT NULL CHECK (expires_at > created_at),
    request_fingerprint text
);

CREATE INDEX IF NOT EXISTS reservations_pending_expiry_idx
    ON reservations (warehouse_id, expires_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS reservation_items (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id uuid NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
    product_id     uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity       integer NOT NULL CHECK (quantity > 0),
    -- Also makes duplicate product ids within one reservation impossible.
    UNIQUE (reservation_id, product_id)
);

CREATE INDEX IF NOT EXISTS reservation_items_product_idx
    ON reservation_items (product_id);
