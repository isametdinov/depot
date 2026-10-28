# DEPOT — Inventory Reservation Service

DEPOT is a small warehouse inventory application: operators can inspect stock,
add stock, and reserve stock for customers. A reservation holds quantities for
15 minutes, can be confirmed or cancelled, and expires automatically — every
request either reserves all requested items or none.

**Use cases it covers**

- List warehouses and products from the live API.
- See how much of a product is physically in a warehouse, how much is held by
  active reservations, and how much is actually available.
- Set (seed) physical stock for a product in a warehouse.
- Create multi-item reservations atomically, with safe retries (`Idempotency-Key`).
- Look up a reservation, confirm it, or cancel it — with a strict, enforced
  state machine.

**Stack**

| Layer | Technology |
|---|---|
| Backend | Go 1.27, standard library `net/http` (no framework), [`pgx`](https://github.com/jackc/pgx) driver |
| Database | PostgreSQL (developed against PostgreSQL 18), SQL migrations applied at startup |
| Frontend | React 19 + TypeScript + Vite 6, hand-rolled CSS (no UI/icon libraries) |
| Tests | Go `testing` + `httptest` against real PostgreSQL; Vitest + Testing Library |

**Architecture — deliberately simple.** One Go process serves a JSON API; the
browser SPA calls it directly over HTTP (CORS allow-list); PostgreSQL stores
everything. No microservices, message queues, caches, ORM, or state
libraries — a junior developer can read every file top to bottom.

**Night/light theme.** The frontend defaults to a muted slate/charcoal **night
mode** for comfortable long sessions, offers a light (soft off-white) mode
with a header toggle, remembers the explicit choice in `localStorage`, and
respects the OS preference on first visit.

**English/Russian interface.** Use the language selector in the header to
switch between English and Russian. The choice is saved in `localStorage` and
applies across the dashboard, inventory, reservations, dialogs and shared
footer.

---

## Features

All implemented and covered by automated tests unless marked otherwise.

- **View stock** — physical, reserved and available quantities per product in
  a warehouse (`GET /warehouses/{w}/products/{p}/stock`), with stock status.
- **Add stock** — set an absolute physical quantity; the API refuses values
  below what pending reservations already hold.
- **Multi-item reservations** — one warehouse, several products, all-or-nothing
  inside a single PostgreSQL transaction.
- **Reservation retrieval** — including the *effective* status (a stale
  `pending` row past its expiry reads back as `expired`).
- **Confirm / cancel** — atomic state transitions; repeated confirm/cancel of
  the same terminal state returns the existing result; invalid transitions are
  rejected with `409`.
- **Expiration** — reservations hold stock for exactly 15 minutes, judged by
  the database clock; no background worker.
- **Idempotency** — `Idempotency-Key` on creation; retries replay the original
  reservation, a different payload on the same key returns `409`.
- **Operations dashboard** — live warehouse, stock and product highlights,
  quick links into inventory and reservations, and an animated stock overview.
- **Frontend night/light mode** with persistence and no startup flash.
- **English and Russian UI** with persistent language selection.
- **Automated testing** — 25 Go tests (unit + real-PostgreSQL integration +
  concurrency) and 29 frontend tests.

**Not implemented (honestly):** a reservation-listing endpoint,
authentication, and an automated browser (E2E) test suite. See
[Known limitations](#known-limitations).

---

## Architecture

```
Browser (React SPA, web/)
   │  fetch + JSON, VITE_API_BASE_URL, CORS allow-list
   ▼
Go API (cmd/server → internal/api → internal/store)
   │  one SQL transaction per operation, SELECT … FOR UPDATE
   ▼
PostgreSQL (tables below, migrations/0000_baseline.sql)
```

**Source directories**

| Path | Contents |
|---|---|
| `cmd/server/main.go` | Entry point: env config, DB pool, runs migrations, HTTP server, graceful shutdown |
| `internal/api/` | HTTP layer: routes (`net/http` ServeMux patterns), request validation, JSON error mapping, CORS |
| `internal/store/` | Business logic: stock math, transactional reservation creation, state transitions, idempotency |
| `migrations/` | `0000_baseline.sql` and `0006_demo_catalog.sql` (embedded via `embed.go`) — idempotent, applied on server/test startup |
| `web/` | React + TypeScript + Vite frontend (pages, components, API client, design system) |

**Transaction boundary.** Every business operation (`set stock`, `create
reservation`, `confirm`, `cancel`) runs inside exactly one `READ COMMITTED`
transaction; any error triggers a rollback, so a partial reservation is
impossible.

**How overselling is prevented.** Reservation creation first executes
`SELECT physical_quantity … FOR UPDATE` on each involved `stock` row, in a
consistent product-id order (deadlock avoidance), *then* computes availability
and inserts rows — all in one transaction. The row lock serializes concurrent
creators **inside PostgreSQL**, so this also holds across multiple server
instances; no in-memory mutex is used anywhere. State transitions are a single
conditional `UPDATE … WHERE status = 'pending' AND expires_at > now()`, which
PostgreSQL re-evaluates after lock waits, so racing confirms/cancels cannot
double-apply.

---

## Prerequisites

- **Go 1.27+** (`go.mod` declares `go 1.27`)
- **Node.js 20+** and **npm** (developed on Node 24, npm 11)
- **PostgreSQL 13+** (developed on 18), either running locally or in the
  included Docker Compose stack
- a C compiler may be needed for optional `go test -race`; it is not required
  for the standard Go tests

---

## Setup and run (Windows PowerShell)

### Run the complete app in Docker

Install Docker Desktop, then from the repository root run:

```powershell
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173). The API is available at
[http://localhost:8080](http://localhost:8080), and its health endpoint is
`http://localhost:8080/api/health`. PostgreSQL data is kept in the
`depot-data` volume across restarts. The Compose defaults use development-only
credentials; set `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` in a
root `.env` file before exposing the database beyond your machine.
On startup, the migration adds a starter warehouse with six sample products
and stock, so inventory and reservations can be tried immediately. Existing
catalog and stock rows are left unchanged.

Stop the containers with `Ctrl+C`, or run `docker compose down`. To also delete
the persisted database, run `docker compose down --volumes`.

### Run locally without Docker

1. Install Go 1.27+, Node.js 20+ with npm, and local PostgreSQL.
2. Start the PostgreSQL Windows service and verify it is accepting
   connections:

   ```powershell
   Get-Service *postgres*
   psql -h 127.0.0.1 -U postgres -d postgres -c "SELECT version();"
   ```

   If `psql` is not on `PATH`, use SQL Shell (psql) or the `psql.exe` in the
   PostgreSQL installation's `bin` directory.
3. Check whether the application database already exists before creating it:

   ```powershell
   psql -h 127.0.0.1 -U postgres -d postgres -c "SELECT datname FROM pg_database WHERE datname = 'depot';"
   ```

   Only if that query returns no row, create it:

   ```powershell
   psql -h 127.0.0.1 -U postgres -d postgres -c "CREATE DATABASE depot;"
   ```
4. In the project root, configure the backend in the current PowerShell
   session and start it:

   ```powershell
   $env:PORT = "8080"
   $env:DATABASE_URL = "postgres://postgres:<your-password>@127.0.0.1:5432/depot?sslmode=disable"
   $env:CORS_ORIGIN = "http://localhost:5173,http://localhost:5174"
   go run ./cmd/server
   ```

   Replace the placeholder password; URL-encode special characters. The
   server applies the embedded SQL migration on startup. The Go process reads
   environment variables directly and does not load `.env` files.
5. In another PowerShell terminal, start the frontend:

   ```powershell
   Set-Location web
   npm install
   Copy-Item .env.example .env.local
   npm run dev
   ```

   Open the URL printed by Vite. It may use port 5174 if 5173 is occupied.
6. To run the frontend checks:

   ```powershell
   npm test
   npm run build
   ```

   From a separate PowerShell terminal opened at the repository root, configure
   a **dedicated disposable database** whose name ends in `_test`. The suite
   creates it if needed and truncates its tables between integration tests;
   never use the application database:

   ```powershell
   $env:DEPOT_TEST_DATABASE_URL = "postgres://postgres:<your-password>@127.0.0.1:5432/depot_test?sslmode=disable"
   go test -count=1 ./...
   Remove-Item Env:DEPOT_TEST_DATABASE_URL
   ```

   If `DEPOT_TEST_DATABASE_URL` is unset, database-backed Go tests are
   explicitly skipped while database-independent tests still run.

### Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `PORT` | backend process | `8080` | HTTP port of the Go API |
| `DATABASE_URL` | backend process | — | Application PostgreSQL DSN, e.g. `postgres://postgres:<password>@127.0.0.1:5432/depot?sslmode=disable` |
| `DEPOT_TEST_DATABASE_URL` | test process / CI | unset | Required for PostgreSQL integration tests; database name must end in `_test`, and its tables are truncated between tests |
| `CORS_ORIGIN` | backend process | `http://localhost:5173,http://localhost:5174` | Comma-separated browser origins allowed to call the API |
| `VITE_API_BASE_URL` | `web/.env.local` | `http://localhost:8080` | API base URL used by the frontend |
| `POSTGRES_USER` | Docker Compose | `depot` | Local development database user |
| `POSTGRES_PASSWORD` | Docker Compose | `depot` | Local development database password |
| `POSTGRES_DB` | Docker Compose | `depot` | Local development database name |

No secrets are committed: `.env` is git-ignored; `.env.example` contains
placeholders only.

---

## API documentation

Base URL: `http://localhost:8080`. All request/response bodies are JSON.
Every error uses one shape:

```json
{"error": {"code": "insufficient_stock", "message": "product 3333… has available 2, requested 5: insufficient stock"}}
```

Status codes: `400` invalid input/JSON/ids · `404` unknown resource ·
`409` insufficient stock, idempotency conflict, invalid transition, expired
reservation, stock-below-reserved · `500` unexpected (details only logged).

### `GET /api/health`

Liveness. `200` → `{"status":"ok"}`.

```powershell
Invoke-RestMethod -Uri "http://localhost:8080/api/health"
```

### `GET /warehouses`

Lists warehouses from PostgreSQL, ordered by name and ID. `200` returns an
array of `{ "id": "...", "name": "..." }` objects; an empty catalog returns
`[]`.

### `GET /products`

Lists products from PostgreSQL, ordered by name and ID. `200` returns an array
of `{ "id": "...", "sku": "...", "name": "..." }` objects; an empty catalog
returns `[]`.

### `GET /warehouses/{warehouse_id}/products/{product_id}/stock`

Current stock picture. IDs are UUIDs.

```powershell
Invoke-RestMethod -Uri "http://localhost:8080/warehouses/11111111-1111-4111-8111-111111111111/products/33333333-3333-4333-8333-333333333333/stock"
```

```json
{
  "warehouse_id": "11111111-1111-4111-8111-111111111111",
  "product_id": "33333333-3333-4333-8333-333333333333",
  "physical_stock": 120,
  "reserved_stock": 0,
  "available_stock": 120
}
```

Errors: `400 invalid_id` (not a UUID), `404 not_found` (no stock row).

### `POST /warehouses/{warehouse_id}/stock`

Sets the **absolute** physical quantity for one product (this is also the
seeding path; missing warehouse/product rows are created with placeholder
names). Required header: `Content-Type: application/json`.

```powershell
$stockBody = @{
  product_id = "33333333-3333-4333-8333-333333333333"
  quantity = 100
} | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/warehouses/11111111-1111-4111-8111-111111111111/stock" `
  -ContentType "application/json" -Body $stockBody
```

`200` → the stock object above. Errors: `400` (bad UUID, quantity outside
0–1,000,000), `409 stock_below_reserved` (would drop below held quantities).

### `POST /reservations`

Creates a multi-item reservation. **Required headers:**
`Content-Type: application/json` and `Idempotency-Key` (non-empty, ≤ 200
characters).

```powershell
$reservationBody = @{
  warehouse_id = "11111111-1111-4111-8111-111111111111"
  items = @(
    @{ product_id = "33333333-3333-4333-8333-333333333333"; quantity = 3 },
    @{ product_id = "55555555-5555-4555-8555-555555555555"; quantity = 5 }
  )
} | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/reservations" `
  -Headers @{ "Idempotency-Key" = "5f0c9e0a-2f7d-4a3e-9c1b-8d2e6a4b7c11" } `
  -ContentType "application/json" -Body $reservationBody
```

`201 Created`:

```json
{
  "id": "2ecb5e7f-698d-48bf-907e-e8f018e6209c",
  "warehouse_id": "11111111-1111-4111-8111-111111111111",
  "status": "pending",
  "expires_at": "2026-10-28T02:52:12.209218+05:00",
  "created_at": "2026-10-28T02:37:12.209218+05:00",
  "items": [
    {"product_id": "33333333-3333-4333-8333-333333333333", "quantity": 3},
    {"product_id": "55555555-5555-4555-8555-555555555555", "quantity": 5}
  ]
}
```

**Idempotency.** Retrying with the **same key and the same normalized payload**
returns the original reservation again (`201`, plus an
`X-Idempotent-Replay: true` header) — it never creates a second reservation or
double-holds stock. Reusing the same key with a **different payload** returns
`409 idempotency_conflict`. Simultaneous same-key requests are safe: the key
is claimed on a unique index inside the creation transaction, so only one
wins.

Other errors: `400 invalid_request` / `invalid_json` /
`missing_idempotency_key` (empty items, zero/negative/oversized quantities,
duplicate product ids, non-UUID ids), `404 not_found` (unknown warehouse or
product), `409 insufficient_stock`, `500`.

### `GET /reservations/{reservation_id}`

```json
{
  "id": "2ecb5e7f-698d-48bf-907e-e8f018e6209c",
  "warehouse_id": "11111111-1111-4111-8111-111111111111",
  "status": "expired",
  "expires_at": "2026-10-28T02:52:12.209218+05:00",
  "created_at": "2026-10-28T02:37:12.209218+05:00",
  "items": [{"product_id": "33333333-3333-4333-8333-333333333333", "quantity": 3}]
}
```

`status` is the **effective** status computed with the database clock: a stored
`pending` row past `expires_at` reports `expired`. Errors: `400`, `404`.

### `POST /reservations/{reservation_id}/confirm`

Finalizes a pending, unexpired reservation (and releases its stock hold).
`200` → the updated reservation (`status: "confirmed"`). Repeating it returns
the same `200` result. Errors: `404`, `409 invalid_transition` (already
cancelled), `409 reservation_expired`.

### `POST /reservations/{reservation_id}/cancel`

Cancels a pending, unexpired reservation and releases its hold (history is
kept). `200` → `status: "cancelled"`; repeats are idempotent. Errors: `404`,
`409 invalid_transition` (e.g. cancelling a **confirmed** reservation),
`409 reservation_expired`.

---

## Database and transaction design

**Tables** (baseline schema defined by
`migrations/0000_baseline.sql`):

| Table | Role |
|---|---|
| `warehouses`, `products` | UUID-keyed entities referenced by everything else |
| `stock` | **Physical stock**, PK `(warehouse_id, product_id)`, `CHECK (physical_quantity >= 0)` |
| `reservations` | One row per reservation: `status` (`CHECK` ∈ pending/confirmed/cancelled/expired), `idempotency_key` **UNIQUE**, `request_fingerprint`, `expires_at` (`CHECK > created_at`), FK → `warehouses` |
| `reservation_items` | One row per held product: `quantity > 0`, `UNIQUE (reservation_id, product_id)`, FK → `reservations` (cascade) / `products` |

**Physical vs available stock.** `stock.physical_quantity` is the only stored
quantity. Availability is derived, never duplicated:

```
available_stock = physical_quantity
                − SUM(reservation_items.quantity for reservations that are
                      pending AND expires_at > now())
```

**Reservation items** are persisted per product; the unique constraint makes
duplicate lines impossible even if validation were bypassed.

**State transitions**

```
pending ──confirm (before expiry)──► confirmed   (terminal)
pending ──cancel (before expiry)──►  cancelled   (terminal)
pending ──expires_at ≤ now()─────►   expired     (terminal)
```

- **Expiration:** exactly 15 minutes after creation, computed in SQL
  (`now() + interval '15 minutes'`) and compared exclusively against
  PostgreSQL's clock — never the Go server's clock.
- **Timestamps:** stored as `timestamptz` (UTC internally), returned as
  RFC 3339 with the server's offset, rendered in the user's local timezone by
  the UI; expiration checks are always database-authoritative.
- **Idempotency persistence:** the key and payload fingerprint live on the
  reservation row itself; uniqueness is enforced by PostgreSQL, and the claim,
  the reservation, and its items commit **atomically** — a failed attempt
  leaves no record and the key stays usable. Scope: one global key space for
  the creation endpoint (there is no authentication — see tradeoffs).

**When one item lacks stock:** the availability check inside the transaction
fails, the deferred rollback discards the reservation, every item row, and the
claimed idempotency key — nothing is partially reserved (proven by tests).

---

## Assumptions and tradeoffs

- **Transition rules:** only `pending → confirmed/cancelled` before expiry;
  expiry is terminal. Terminal states never transition again.
- **Repeated confirm/cancel:** returning `200` with the existing result for
  the *same* terminal state (idempotent) rather than an error; everything else
  invalid is a `409`. Confirming an expired reservation is always `409`.
- **Confirm releases the hold** (per the assignment's stock rule) — in a real
  warehouse, confirming would eventually *fulfill* and deduct physical stock;
  fulfillment is intentionally out of scope.
- **Idempotency scope/retention:** keys are global (no auth exists), and
  records live as long as their reservation row — no pruning job.
- **Lazy expiration:** no background worker; effective status is derived at
  read/transition time, which removes any expire-vs-confirm race.
- **Intentionally omitted:** reservation listing (reservations are looked up
  by ID), authentication, pagination, product/warehouse create-edit-delete
  endpoints, and background expiration sweeps. The stock endpoint creates
  placeholder-named product and warehouse rows for seeding; the frontend also
  preserves manually entered UUIDs locally.

---

## Testing

```powershell
# From the repository root; use a disposable PostgreSQL database ending in _test.
$env:DEPOT_TEST_DATABASE_URL = "postgres://postgres:<your-password>@127.0.0.1:5432/depot_test?sslmode=disable"
go test -count=1 ./...
Remove-Item Env:DEPOT_TEST_DATABASE_URL

# Frontend checks do not need PostgreSQL.
Set-Location web
npm test
npm run build
```

**What needs a running service**

| Tests | Needs |
|---|---|
| Go unit tests (validation, error→HTTP mapping, JSON, key rules, fingerprint) | nothing |
| Go integration tests (HTTP, catalog, reservation, and concurrency cases) | PostgreSQL via explicit `DEPOT_TEST_DATABASE_URL` pointing to a dedicated database ending in `_test`; the suite creates it if needed and truncates its tables between tests |
| Frontend tests (26) | nothing (`fetch` is mocked) |
| Live browser/curl walkthrough | backend + `npm run dev` |

If PostgreSQL is unreachable, DB-backed Go tests skip with a loud, documented
environmental warning; mocks are **never** substituted for PostgreSQL.

**How the concurrency test proves stock cannot be oversold.** Two
barrier-synchronized tests open genuinely separate pool connections against
the real database:

1. *5 units, ten simultaneous 1-unit reservations* → the outcome is
   deterministic because every creator must take the same `FOR UPDATE` row
   lock: exactly 5 × `201`, 5 × `409 insufficient_stock`, `SUM(reserved) = 5`,
   physical stock unchanged at 5, available 0.
2. *5 units, two simultaneous 4-unit reservations* → exactly one succeeds and
   one gets `409`; exactly one reservation and one item row exist (the loser
   leaves no partial rows), reserved = 4 ≤ 5, and physical/available are never
   negative.

No sleeps are used as proof — only start barriers plus deterministic
assertions over API responses **and** SQL state.

---

## Known limitations

- **No reservation-listing endpoint:** reservations are retrieved by ID. The
  inventory page loads warehouse and product catalogs from the API and keeps
  any manually entered UUIDs in a local watchlist.
- **Starter catalog:** migration `0006_demo_catalog.sql` inserts one sample
  warehouse, six products and initial stock when they are absent. This is
  useful for local review, but production deployments should replace or remove
  the sample catalog as appropriate; existing rows are not overwritten.
- **No authentication:** idempotency keys are globally scoped, stock endpoints
  are unauthenticated.
- Idempotency records are retained indefinitely (no pruning); one fixed
  15-minute TTL.
- The stock endpoint creates missing warehouse/product rows with placeholder
  names and can overwrite absolute stock (seeding convenience by design).
- **`go test -race` was not executed** — run it in an environment with the
  required C compiler.
- **No automated browser (E2E) suite** — frontend/backend integration was
  manually checked in the browser and over HTTP, but is not covered by an
  automated browser test suite.
- Docker Compose is provided for local development; it uses development-only
  default PostgreSQL credentials and is not a production deployment setup.

## Future improvements

Proportionate next steps — **none of these are implemented**:

- A per-warehouse product/stock listing endpoint to reduce the inventory
  screen's individual stock requests and its locally stored watchlist.
- A reservation listing endpoint with pagination.
- A retention job pruning old idempotency records.
- A CI pipeline running `go test -race` and Playwright E2E checks.
- Optional per-request TTL and a sweeper that persists `expired` statuses.
#   d e p o t  
 