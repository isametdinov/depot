# TASKS.md — DEPOT Inventory Reservation Service

Audit of assignment requirements against the repository, updated after the
Docker, starter-catalog, and dashboard work on 2026-10-28.

- **Status legend:** `DONE` — implemented and verified · `PARTIAL` — some
  implementation exists or verification remains · `MISSING` — not
  implemented · `BROKEN` — verification failed.
- **Git:** initialized, but project files are untracked; there are no commits
  or configured remotes. No changes were committed or pushed.
- **Environment checked:** Go 1.27.3, Node 24.18.0, npm 11.16.0, PostgreSQL
  18 service running. `psql` is installed but not on `PATH`. No local `.env`
  file was present.
- **Verification:** Go tests and `go vet ./...` passed in a temporary Go
  container against a fresh PostgreSQL database ending in `_test`; it was
  removed afterward. All 26 frontend tests passed and the production build
  succeeded. Docker Compose started; the health and catalog APIs, stock
  update, and reservation create/cancel paths were checked live.

## A. Repository and local setup

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Go backend, React + TypeScript + Vite frontend, SQL migrations | DONE | `cmd/server/`, `internal/`, `migrations/`, `web/`; Go and frontend builds verified |
| Git initialized and source tracked | PARTIAL | All project files are untracked; no commits or remotes. Commit only if requested |
| HTTP entry point and graceful shutdown | DONE | `cmd/server/main.go`; server started against a fresh isolated database and health/catalog endpoints returned 200 |
| Safe environment configuration | DONE | `.env.example`, `web/.env.example`; Go integration tests require an explicit disposable `_test` database; no password is hardcoded in Go source |
| Windows local setup instructions | DONE | `README.md` documents PowerShell environment setup and local PostgreSQL; clean-machine setup not independently executed |

## B. PostgreSQL schema and migrations

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Warehouses, products, stock, reservations, reservation items | DONE | `migrations/0000_baseline.sql`; embedded migration applied by PostgreSQL integration tests |
| Migration run path | DONE | `migrations/embed.go`, `internal/store/store.go`; test setup applies the embedded migration |
| Database constraints | DONE | Primary/foreign keys, unique keys, quantity checks, and status checks in baseline migration; exercised by tests |
| Seed data for a fresh database | DONE | `migrations/0006_demo_catalog.sql` idempotently adds a sample warehouse, six products, and stock without overwriting existing rows |
| Data access and transactions | DONE | `internal/store/`; PostgreSQL-backed tests pass |

## C. Catalog and inventory API

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| List warehouses and products | DONE | `GET /warehouses`, `GET /products` in `internal/api/`; `TestCatalogEndpoints` |
| Read physical, reserved, and available stock | DONE | `GET /warehouses/{warehouse_id}/products/{product_id}/stock`; `TestStockEndpoints` |
| Add/set stock with validation | DONE | `POST /warehouses/{warehouse_id}/stock`; rejects invalid quantities and reductions below active reservations |
| Consistent JSON errors | DONE | `internal/api/errors.go`; tested status/error mapping |

## D. Reservation lifecycle

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Atomic multi-item reservation | DONE | `internal/store/reservations.go`; rollback tests prove no partial holds |
| Confirm and cancel valid pending reservations | DONE | Conditional database transitions; lifecycle and transition tests |
| Expire pending reservations after 15 minutes using database time | DONE | Effective status and availability use PostgreSQL time; deterministic expiration tests |
| Persistent idempotency and conflicting-key behavior | DONE | Unique key and request fingerprint; replay, conflict, and concurrent same-key tests |

## E. Concurrency and automated tests

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| PostgreSQL transaction and row-lock protection | DONE | `SELECT ... FOR UPDATE` in reservation creation; database-backed test suite |
| Prevent overselling across concurrent requests | DONE | Barrier-synchronized concurrency tests pass against PostgreSQL |
| Backend tests for API, lifecycle, constraints, and concurrency | DONE | `go test -count=2 ./...` passed with a dedicated temporary PostgreSQL test DB; `go vet ./...` passed |
| Race-detector verification | PARTIAL | `go test -race` was not run |
| Safe integration-test database selection | DONE | `internal/api/testenv_test.go` requires `DEPOT_TEST_DATABASE_URL`, rejects names without `_test` suffix (guard test passed), and truncates only its dedicated test DB |

## F. Frontend

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| React + TypeScript + Vite app | DONE | `web/`; strict TypeScript and production build pass |
| Live warehouse/product catalog and inventory | DONE | `web/src/pages/InventoryPage.tsx` loads catalog and stock from API |
| Add stock and create multi-item reservations | DONE | `web/src/components/AddStockModal.tsx`, `CreateReservationModal.tsx` |
| Look up, confirm, and cancel reservations | DONE | `web/src/pages/ReservationsPage.tsx` |
| Loading, validation, success, and error states | DONE | API errors and operation feedback are surfaced in UI |
| Persistent light/dark theme | DONE | `web/src/theme.ts`, `ThemeToggle.tsx`, `styles.css`; theme tests pass |
| Dashboard introduction and live metrics | DONE | `web/src/pages/DashboardPage.tsx`; data loaded from the API, navigation into workflows verified in browser |
| Automated frontend tests/build | DONE | `npm test` passed (26 tests); `npm run build` passed |
| Browser/E2E and visual responsive checks | PARTIAL | Dashboard manually inspected in browser; no automated E2E or responsive viewport matrix |

## G. Documentation and submission state

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Accurate setup, API, test, and limitation documentation | DONE | `README.md` now documents Docker, sample data, API routes, and test execution |
| Review of original reservation function | DONE | `REVIEW.md` describes business-rule and implementation defects and their corrections |
| AI assistance disclosure | PARTIAL | Tools, tasks, and verification documented. Assignment requires one genuinely rejected AI suggestion and a precise account of human changes; the available record does not establish these, so the owner must complete them truthfully |
| No credentials committed or pushed | DONE | No `.env` file; `.env` is ignored; no commits or remotes exist |

## Remaining or unverified

- Automated browser/E2E coverage and a responsive viewport matrix remain absent.
- `go test -race` was not run.
- All project files are still untracked; there is no commit hash or remote.
- The project owner must provide the repository URL, target commit hash, and
  approximate time spent for the submission note.
