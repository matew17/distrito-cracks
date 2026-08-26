# Implementation Plan: Court Reservations

**Branch**: `feat/001-court-reservations` | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-court-reservations/spec.md`

## Summary

Add a `reservations` bounded context that lets an authenticated customer book a
court over a time range, list their own active reservations, and cancel one they
own. Eight business rules are in scope (BR-01, BR-02, BR-03, BR-06, BR-07,
BR-08, BR-09, BR-10).

The load-bearing technical decision is BR-01. Overlap prevention is placed in
Postgres as an `EXCLUDE USING gist` constraint over `(courtId, tstzrange(start,
end, '[)'))` restricted to non-cancelled rows, because a service-level
check-then-insert cannot survive two concurrent requests for the same slot. The
service still pre-checks to produce a good error message, but the constraint is
the authority: the insert is wrapped so a `23P01` violation becomes a 409
conflict. `'[)'` bounds give back-to-back bookings for free.

Two schema additions follow from the clarified spec: per-weekday operating hours
on a court (a weekday with no row is closed), and a `underMaintenance` flag kept
separate from the existing `isActive`.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js (NestJS 11)

**Primary Dependencies**: NestJS 11, Prisma 7.10 with the `@prisma/adapter-pg`
driver adapter, `pg` 8.

**Dependencies this feature adds** — the constitution mandates DTO validation
(§I) but neither package is in `package.json`, and `src/main.ts` registers no
global pipe, so the validation stack has to be stood up before any DTO can work:

| Package | Version | Why |
|---------|---------|-----|
| `class-validator` | `^0.15.1` | The `@IsUUID`/`@IsISO8601` decorators and the custom BR-02 duration constraint |
| `class-transformer` | `^0.5.1` | Peer of the above; turns the raw JSON body into a DTO instance so validators see typed values |

Both go in `dependencies`, not `devDependencies` — they are needed at runtime.
Wiring is `app.useGlobalPipes(new ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true, transform: true }))` in `src/main.ts`.
`forbidNonWhitelisted` is the load-bearing flag: it makes an unknown property a
400 rather than silently dropping it, which is what stops a caller smuggling
`customerId`, `status` or `price` past the contract and is therefore part of how
BR-08 stays enforceable. Tasks T001 (install) and T002 (wire) cover this and
block every DTO task.

**Storage**: PostgreSQL 15 (`docker-compose.yml`, service `db`). Requires the
`btree_gist` extension, enabled by migration.

**Testing**: Jest 30. Unit specs via `npm test` (`rootDir: src`, `*.spec.ts`);
integration/e2e via `npm run test:e2e` (`test/*.e2e-spec.ts`) against the real
Postgres from `npm run db:up`.

**Target Platform**: Linux server / local Docker

**Project Type**: Web service (REST API, no frontend in this repo)

**Performance Goals**: Venue scale — tens of concurrent users. Correctness under
concurrency dominates throughput; no latency target is being engineered for
beyond keeping the overlap check a single indexed statement.

**Constraints**: No `any` in public signatures. Prisma error text must never
reach a client. Applied migrations are immutable — all changes land as a new
migration. Times are stored as `TIMESTAMPTZ(3)`; operating hours are evaluated
in the venue's local timezone.

**Scale/Scope**: 3 endpoints, 2 new NestJS modules (+1 shared), 4 entities (2
extended, 1 new, 1 untouched), 1 migration containing raw SQL.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against `.specify/memory/constitution.md`.

| Principle | Gate | Verdict |
|-----------|------|---------|
| I. One module per bounded context | `reservations` and `courts` are separate modules; `courts` is read-only here and exposes no controller | PASS |
| I. Controllers hold no business logic | Controller does DTO binding, calls the service, maps the result. Every rule lives in `ReservationsService` or the DB | PASS |
| I. Services = rules, repositories = Prisma | `ReservationsRepository` / `CourtsRepository` are the only Prisma callers | PASS |
| I. DTO + class-validator on all input | Requires adding the two missing packages and a global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) | PASS (with dependency addition) |
| I. No `any` in public signatures | Prisma-generated types from `src/generated/prisma`; typed domain results | PASS |
| II. Migration in the same commit as the schema change | One migration created with `--create-only`, then hand-extended with the raw SQL Prisma cannot express | PASS |
| II. Never edit an applied migration | The existing `20260825163757_init` is untouched | PASS |
| II. Invariants expressible in Postgres live in Postgres | BR-01 → `EXCLUDE USING gist` (partial, non-cancelled). BR-02 → validated `CHECK` on duration only (start instant unconstrained). BR-03/06/07/08/09/10 are not expressible as static constraints (cross-table, or depend on `now()`) and stay in the service — see research.md for why each | PASS |
| III. Every BR-xx has a test naming its ID | Test titles carry the literal ID, e.g. `BR-01: rejects an overlapping reservation`. FR-018 makes this a spec requirement | PASS |
| III. Concurrency/overlap rules tested on real Postgres | BR-01 is proven by a concurrent-insert e2e test against the Docker database; no mocked Prisma client | PASS |
| IV. Domain exceptions mapped to HTTP in a global filter | `DomainExceptionFilter` maps a domain error hierarchy to status + stable rule code | PASS |
| IV. Never expose Prisma messages | The repository translates `23P01` into a domain conflict; the filter has a catch-all that logs internally and returns a generic 500 body | PASS |
| V. Conventional Commits, one per task, branch `feat/<spec-id>-<slug>` | Branch `feat/001-court-reservations`; tasks.md is one commit per task | PASS |
| VI. Agent implements current task only | Enforced by the sdd-implement loop, not by this plan | PASS |

**Gate result: PASS.** No violations to justify; Complexity Tracking below records
the two design choices most likely to be questioned.

## Project Structure

### Documentation (this feature)

```text
specs/001-court-reservations/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── reservations-api.md
├── checklists/
│   └── requirements.md  # from /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
prisma/
├── schema.prisma                          # + CourtOperatingHour, Court.underMaintenance
└── migrations/
    ├── 20260825163757_init/               # existing, untouched
    └── <ts>_court_reservations/
        └── migration.sql                  # generated DDL + hand-written raw SQL

src/
├── common/
│   ├── domain/
│   │   └── domain.exception.ts            # base + rule-coded subclasses
│   ├── filters/
│   │   └── domain-exception.filter.ts     # global, maps domain -> HTTP
│   ├── auth/
│   │   ├── current-customer.guard.ts      # resolves requester identity
│   │   └── current-customer.decorator.ts  # @CurrentCustomer() param
│   └── time/
│       └── venue-time.ts                  # weekday + minutes-of-day in venue tz
├── courts/
│   ├── courts.module.ts                   # no controller: management is out of scope
│   ├── courts.service.ts                  # bookability + operating-hours lookup
│   └── courts.repository.ts
├── reservations/
│   ├── reservations.module.ts
│   ├── reservations.controller.ts
│   ├── reservations.service.ts             # BR-02, BR-03, BR-06..BR-10
│   ├── reservations.repository.ts          # Prisma + 23P01 translation (BR-01)
│   ├── dto/
│   │   ├── create-reservation.dto.ts       # BR-02, BR-06 at the edge
│   │   └── reservation.response.ts
│   └── *.spec.ts                           # unit specs, colocated per repo convention
├── prisma/                                 # existing PrismaService
├── app.module.ts                            # + CourtsModule, ReservationsModule
└── main.ts                                  # + global ValidationPipe, + global filter

test/
├── reservations.e2e-spec.ts                # BR-01 concurrency, BR-08 ownership
└── jest-e2e.json                            # existing
```

**Structure Decision**: Two new NestJS modules under `src/`, matching the
existing flat `src/<domain>/` convention already set by `src/prisma/`. Unit specs
sit beside their subject because Jest is configured with `rootDir: src` and
`testRegex: .*\.spec\.ts$`; anything needing a live database goes in `test/` as
an `*.e2e-spec.ts`, which is the only suite pointed at real Postgres. `courts`
is a module rather than a folder inside `reservations` because a court is its own
bounded context that reservations merely reads — and court management, when it
arrives, will land there without touching reservations.

## Post-Design Constitution Re-Check

Re-run after Phase 1. Still **PASS**. Three things surfaced during design that
were not visible at the first gate:

1. **§II is satisfied more strictly than first planned.** BR-02 turned out to be
   expressible as a `CHECK` constraint, not just DTO validation, so it moved into
   the database as well, fully validated — the table is confirmed empty, so there
   are no legacy rows to grandfather (research.md R6). research.md R8
   records, rule by rule, why the remaining six cannot follow — each depends on
   `now()`, another table, or the caller, none of which a static constraint can
   read. BR-02 covers **duration only**; an earlier draft also enforced start
   alignment to `:00`/`:30`, which `/speckit-analyze` caught as scope no
   requirement authorised. It was removed after the product owner confirmed
   BR-02 means "duration is a multiple of 30 minutes".
2. **§IV has a concrete failure mode.** The exclusion-constraint violation is the
   one place Prisma text could reach a client. Its error shape under the Prisma 7
   driver adapter is **not** assumed — research.md R2 marks it VERIFY, and the
   integration test asserts the response body contains no SQLSTATE, SQL or table
   name.
3. **§III needs a negative control.** A concurrency test can pass for the wrong
   reason. quickstart.md documents dropping the constraint and re-running to
   confirm the test actually fails — §III calls a test that passes when its rule
   is broken a defect, and this is how we rule that out.

No new violations. Nothing in Complexity Tracking changed.

## Complexity Tracking

> Recorded for review, not because the Constitution Check failed.

| Choice | Why Needed | Simpler Alternative Rejected Because |
|--------|------------|--------------------------------------|
| Raw SQL appended to a Prisma migration | Prisma's schema language cannot express `EXCLUDE USING gist`, and constitution §II requires the overlap invariant to live in the DB | A Prisma `@@unique` on `(courtId, startTime)` only stops identical start times — it lets 18:00–19:30 and 19:00–20:00 both commit. A service-level check-then-insert loses to concurrency, which SC-002 explicitly tests for |
| A `courts` module with no controller | Reservations must read operating hours and maintenance state; that read belongs to the court context | Reading the `Court` table straight from `ReservationsRepository` would put one context's persistence inside another and break §I as soon as court management is added |
| Placeholder identity guard (`X-Customer-Id`) | BR-08 is unenforceable without a trustworthy requester identity, and this repo has no auth module | Taking `customerId` from the request body makes BR-08 decorative — any caller could claim any identity. Building real authentication is a separate feature, not this one. See research.md R5 |
| `CHECK` constraint for BR-02 *in addition to* the DTO | §II: a duration rule is expressible in Postgres, so it belongs there too | DTO-only validation is bypassed by any non-HTTP writer (seed scripts, future admin tools) |
