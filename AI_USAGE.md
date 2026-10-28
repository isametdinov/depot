# AI_USAGE.md — Disclosure of AI-Assisted Development

This document discloses how AI was used while building the DEPOT Inventory
Reservation Service, as required by the assignment.

## Tool and nature of use

- **Tool:** an AI coding assistant (Codebuff, agent "Buffy", a large language
  model) operated by the project owner through a chat interface. The
  2026-10-28 repository audit and changes were also completed with Copilot SDK
  in VS Code.
- **Role:** AI acted purely as a **development-time tool** — generating,
  editing, reviewing and testing code and documentation on request. It was
  *not* used to write the assignment specification; all task specifications
  were provided by the project owner.
- **No AI in the product:** the application itself contains **no AI
  features** — no chatbots, assistants, recommendations, analytics, or model
  calls. Runtime dependencies are Go + pgx, PostgreSQL, React + Vite only.

## What AI produced, per area

| Area | AI contribution | How it was verified |
|---|---|---|
| Repository audit & plan (`TASKS.md`) | Requirement-by-requirement checklist with statuses and verification methods | Cross-checked against actual code on disk after each task |
| Database schema | Reviewed the checked-in UUID schema and embedded baseline migration | Actual migration applied by PostgreSQL integration tests on an isolated test database |
| Reservation engine (`internal/store/`, `internal/api/`, `cmd/server/`) | Transactional creation with `SELECT … FOR UPDATE`, idempotency claim, lazy expiration, conditional transitions, validation, JSON error contract | Go unit, HTTP integration, and concurrency tests passed against real PostgreSQL in an isolated `_test` database; `go vet ./...` passed |
| Catalog API and frontend integration (2026-10-28 audit) | Added warehouse/product listing endpoints, wired live catalog data into the inventory screen, and made integration-test database selection explicit and safe | `TestCatalogEndpoints`; full Go test suite and `go vet ./...`; frontend tests and build |
| CORS middleware (`internal/api/cors.go`) | Minimal origin allow-list so the browser frontend can call the API | `TestCORS` unit test + curl preflight/actual-request checks while both servers ran |
| Docker and starter catalog | Added Compose services for PostgreSQL, Go API and static frontend, plus an idempotent sample-catalog migration | `docker compose config`, image build, live API health/catalog/stock checks, stock update and reservation create/cancel |
| Dashboard (`web/src/pages/DashboardPage.tsx`) | Added a live-data introduction page with responsive layout, inline SVG stock ring, subtle CSS animation, warehouse selection and links to existing workflows | Dashboard UI test; all 26 Vitest tests, TypeScript production build, and manual browser inspection |
| Frontend (`web/`) | React + TypeScript + Vite app: inventory page, reservation forms/details, API client, CSS-variable theming with persistent toggle | Strict `tsc` build passes; `npm run build` produces the bundle; 26 Vitest tests pass; live browser/API checks performed, but no automated browser suite |
| Tests (`*_test.go`, `web/src/**\/*.test.*`) | All test code in this repository, including the deterministic concurrency scenarios | Every test was executed; failures found along the way (e.g. expired-transition mapping, schema mismatch) were fixed in the implementation and re-run green |
| Documentation (`README.md`, `REVIEW.md`, this file) | Drafted by AI from the actual implementation; every claim was checked against running code or adjusted to match it | Commands in the README were executed on this machine during development |

## Review and acceptance by the project owner

- The project owner directed each task, supplied the assignment requirements,
  and can re-run the verification commands in `README.md`:
  `go vet ./...`, `go test ./... -count=2`, `cd web && npm test`,
  `cd web && npm run build`.
- Known unverified items are stated openly in `README.md` → *Known
  limitations* (`go test -race` and an automated browser/E2E suite have not
  been run).
- The project owner is responsible for understanding and defending the code;
  `REVIEW.md` documents the design reasoning in the owner's submission.

## Required reflection

- **AI tools:** Codebuff (agent "Buffy") and Copilot SDK in VS Code.
- **Tasks requested:** implementation, code review, tests, documentation,
  Docker setup, and the dashboard UI described above.
- **Suggestion not adopted:** no specific AI-generated suggestion can be
  verified from the available development record. During the dashboard work,
  a separate router or charting dependency was not introduced; the small
  existing app navigation and inline SVG/CSS were sufficient. The project
  owner should replace this with a specific rejected suggestion if one was
  made in an earlier, unrecorded session rather than inventing one.
- **Generated code substantially changed or simplified:** the dashboard was
  iterated against its test and browser output; no separate substantial
  owner-authored rewrite is recorded here. The project owner should add any
  manual changes they made outside this AI-assisted work.

## Honest statement of scope

- All code, tests, and documents in this repository were written or
  substantially edited with AI assistance.
- No test result reported in this repository comes from a run that did not
  happen; no feature is documented as working unless its implementation was
  executed as part of the verification described above.
- In the earlier 2026-10-28 audit, `go test -count=2 ./...` ran against a temporary
  PostgreSQL database whose name ended in `_test`; the database was removed
  after the run. `go vet ./...`, `npm test` (25 frontend tests), and
  `npm run build` also passed. The server was started with a fresh temporary
  database and health/catalog endpoints were checked over HTTP. In the later
  dashboard session, all 26 frontend tests passed, the frontend built, the
  Docker services started, and the dashboard was inspected in the browser.
