---
description: "Task list for Court Reservations"
---

# Tasks: Court Reservations

**Input**: Design documents from `/specs/001-court-reservations/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/reservations-api.md, quickstart.md

**Tests**: REQUIRED, not optional. Constitution §III mandates a test naming each
BR-xx ID, and spec.md FR-018 makes that traceability a requirement of the
feature. BR-01 must run against real Postgres, never a mocked Prisma client.

**Organization**: Grouped by user story. Each story is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = create, US2 = list active, US3 = cancel

## Path Conventions

NestJS single project. Source in `src/`, unit specs colocated as
`src/**/*.spec.ts` (Jest `rootDir: src`), database-backed tests in
`test/*.e2e-spec.ts` (`npm run test:e2e`). Prisma schema and migrations in
`prisma/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Close the two gaps found during planning — the validation stack the
constitution requires is not installed, and no global pipe is registered.

- [x] T001 Install the validation stack: `npm install class-validator@^0.15.1 class-transformer@^0.5.1` (runtime `dependencies`, not dev — DTOs need them at runtime). Constitution §I mandates DTO validation and neither package is currently in `package.json`. **Blocks T019, T023 and every DTO task**; nothing downstream can validate input until this lands.
- [x] T002 Register the global `ValidationPipe` in `src/main.ts` — `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))`. Each flag earns its place: `whitelist` strips unknown properties, `forbidNonWhitelisted` turns them into a 400 instead of silently dropping them (so a caller cannot smuggle `customerId`, `status` or `price` — the contract depends on this), and `transform` is what turns the raw body into a real DTO instance so the custom BR-02 constraint receives typed `Date` values rather than strings. Requires T001.
- [x] T003 [P] Document `VENUE_TIMEZONE` (default `America/Bogota`) in `.env.example` and read it via `process.env` in the time helper; BR-03's outcome must not depend on the host's `TZ` (research.md R4).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, constraints, error mapping and identity. Every user story
depends on all of it.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Database

- [x] T004 Update `prisma/schema.prisma`: add `Court.underMaintenance Boolean @default(false)`, add the `CourtOperatingHour` model (`courtId`, `dayOfWeek`, `opensAt`, `closesAt`, `@@unique([courtId, dayOfWeek])`, cascade delete) and its relation on `Court`, and change `Reservation.status` default to `CONFIRMED`. Fields and rationale in data-model.md. Leave `customerId` nullable and do not touch `price`, `isRecurring`, `isTraining`.
- [x] T005 Run the pre-migration overlap audit from quickstart.md. **The `Reservation` table is confirmed empty (2026-08-25), so this is a confirmation, not an expected blocker** — zero rows → proceed to T006. If it unexpectedly returns rows, STOP and report them; the exclusion constraint validates on creation and cannot be deferred, and rewriting pre-existing data is out of scope (§VI).
- [x] T006 Create the migration with `npx prisma migrate dev --name court_reservations --create-only`, then hand-append to the generated `prisma/migrations/<ts>_court_reservations/migration.sql`: `CREATE EXTENSION IF NOT EXISTS btree_gist`, the `Reservation_no_overlap_per_court` exclusion constraint (`'[)'` bounds, `WHERE status <> 'CANCELLED'`), the `Reservation_duration_valid` CHECK (**fully validated, not `NOT VALID`** — the table is empty, so there is nothing to grandfather; duration compared in **milliseconds** so no rounding can admit a near-30-minute slot), and the `CourtOperatingHour` range CHECKs. Exact SQL in data-model.md. Schema change and migration land in the same commit (§II).
- [x] T007 Apply with `npx prisma migrate dev`, then `npx prisma generate` to refresh `src/generated/prisma`. Confirm the constraint exists via `\d "Reservation"`.

### Cross-cutting infrastructure

- [x] T008 [P] Create the domain exception hierarchy in `src/common/domain/domain.exception.ts`: a base carrying `code`, `rule` and HTTP status, plus one subclass per row of the error table in contracts/reservations-api.md.
- [ ] T009 Create `src/common/filters/domain-exception.filter.ts` mapping domain exceptions to the documented status + `{ statusCode, code, rule, message }` envelope, with a catch-all that logs the real error server-side and returns a generic 500. Register it globally in `src/main.ts`. Never emit Prisma text (§IV).
- [x] T010 [P] Create `src/common/time/venue-time.ts` exposing venue-local weekday (`0`=Sunday) and minutes-from-midnight for an instant, using `Intl.DateTimeFormat` with the configured zone — no new dependency (research.md R4).
- [x] T011 [P] Add unit spec `src/common/time/venue-time.spec.ts` covering weekday/minute extraction, midnight and `closesAt = 1440` boundaries, and that results are independent of the process `TZ`.
- [ ] T012 [P] Create `src/common/auth/current-customer.guard.ts` and `current-customer.decorator.ts`: resolve the `X-Customer-Id` header to a `Customer`, 401 on missing/unknown, attach to the request. Include the comment from research.md R5 stating this is a spoofable placeholder that must not ship publicly. Never read the customer id from a body or route param — BR-08 depends on it.
- [x] T013 Create `src/courts/` — `courts.module.ts` (no controller; court management is out of scope), `courts.repository.ts` (Prisma access: court by id with its operating hours), `courts.service.ts` (bookability: `isActive`/`underMaintenance`, and the weekday window lookup). Export the service.
- [ ] T014 Create `src/reservations/reservations.module.ts` importing `PrismaModule` and `CourtsModule`, and register both `CourtsModule` and `ReservationsModule` in `src/app.module.ts`.
- [x] T015 [P] Add an e2e harness in `test/` providing per-test truncation of `Reservation`/`CourtOperatingHour`/`Court`/`Customer` and helpers to seed a bookable court (open 08:00–22:00 Mon–Sat, Sunday deliberately unconfigured) plus two customers, per quickstart.md.

**Checkpoint**: Schema, constraints, error mapping, identity and modules exist.
User story work can begin.

---

## Phase 3: User Story 1 - Reserve a court for a time range (Priority: P1) 🎯 MVP

**Goal**: A customer can book a bookable court for a legal future slot, and every
illegal request is refused with a reason naming its rule.

**Independent Test**: Seed a court with hours and no reservations; book a valid
future slot successfully, then replay each rejection condition (overlap, bad
duration, outside hours, closed day, past slot, maintenance) and
confirm each is refused distinctly.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [ ] T016 [P] [US1] `test/reservations.e2e-spec.ts`: **BR-01 under concurrency** — 50 simultaneous `POST /reservations` for the identical court and slot via `Promise.allSettled`; assert exactly one 201, 49 conflicts, and exactly one active row in the table (SC-002). Real Postgres, real `PrismaService` (§III).
- [ ] T017 [P] [US1] `test/reservations.e2e-spec.ts`: **BR-01 boundary** — 18:00–19:30 then 19:30–21:00 on the same court both succeed; `'[)'` bounds mean touching is not overlapping. Then 19:00–20:00 is refused. Also assert **FR-019**: each created reservation comes back with `status: "CONFIRMED"`.
- [ ] T018 [P] [US1] `test/reservations.e2e-spec.ts`: **BR-01 error translation** — provoke a real constraint violation and assert the response is the documented 409 envelope and that the body contains no `23P01`, no SQL, no constraint or table name (§IV). This is the VERIFY in research.md R2: discover the actual error shape here rather than assuming it. Also assert **FR-009** across the rejection paths (overlap, bad duration, outside hours, maintenance): after each refusal the `Reservation` row count is unchanged — no partial or placeholder row is persisted.
- [ ] T019 [P] [US1] `src/reservations/dto/create-reservation.dto.spec.ts`: **BR-02** — reject 45, 30, 75 and 210 min, plus inverted and zero-length ranges; accept 60/90/120/150/180 min; **accept a 90-minute slot starting at 18:10** — BR-02 constrains duration only, there is no start-alignment rule (spec.md FR-003). Also reject a duration off by milliseconds (e.g. 60 min + 400 ms), which the DTO must catch by comparing exact millisecond differences.
- [ ] T020 [US1] `src/reservations/reservations.service.spec.ts`: **BR-03** — reject 21:00–23:00 and 06:00–07:30 against 08:00–22:00; reject a weekday with no configured hours as closed; reject a slot crossing a venue-local day boundary; accept a slot ending exactly at closing time. Not `[P]`: shares a file with T021, T028, T033, T034.
- [ ] T021 [US1] `src/reservations/reservations.service.spec.ts`: **BR-06** — reject a start in the past and a slot that started in the past but ends in the future; accept a future slot. Also assert **FR-007**: an unknown `courtId` is refused as not found. Not `[P]`: shares a file with T020, T028, T033, T034.
- [x] T022 [P] [US1] `src/courts/courts.service.spec.ts`: **BR-07** — a court with `underMaintenance = true` is not bookable; a court with `isActive = false` is not bookable for its own distinct reason; a court that is active and not under maintenance is bookable.

### Implementation for User Story 1

- [ ] T023 [US1] Create `src/reservations/dto/create-reservation.dto.ts` — `courtId` (UUID), `startTime`/`endTime` (ISO-8601 with offset), plus a custom class-validator constraint enforcing BR-02: `endTime > startTime`, and the millisecond difference between 3 600 000 and 10 800 000 and an exact multiple of 1 800 000. **No start-alignment check** — BR-02 constrains duration only.
- [ ] T024 [P] [US1] Create `src/reservations/dto/reservation.response.ts` and a mapper producing the documented shape (`id`, `courtId`, `courtName`, `startTime`, `endTime`, `status`, `price`). Never echo `customerId`.
- [ ] T025 [US1] Create `src/reservations/reservations.repository.ts` with `findOverlapping(courtId, start, end)` (pre-check, non-cancelled only) and `create(...)` that catches the `23P01` exclusion violation — checking both the `PrismaClientKnownRequestError` path and the `@prisma/adapter-pg` driver error's `code` — and rethrows `ReservationOverlapError` (research.md R2).
- [ ] T026 [US1] Implement `ReservationsService.create()` in `src/reservations/reservations.service.ts` evaluating in the fixed order from contracts/reservations-api.md: court exists (404) → bookable, BR-07 (409) → not past, BR-06 (400) → within the weekday window, BR-03 (409) → overlap pre-check, BR-01 (409). Set `status: CONFIRMED` and `customerId` from the guard-resolved requester, never from the payload.
- [ ] T027 [US1] Add `POST /reservations` to `src/reservations/reservations.controller.ts` — guard, DTO binding, `@CurrentCustomer()`, 201 with the response DTO. No business logic in the controller (§I).

**Checkpoint**: US1 fully functional. A customer can book; all seven rejection
paths are distinct; the overlap invariant holds under concurrency.

---

## Phase 4: User Story 2 - See my active reservations (Priority: P2)

**Goal**: A customer sees exactly their own upcoming, non-cancelled reservations,
earliest first.

**Independent Test**: Seed one customer with upcoming, cancelled and
already-finished reservations plus another customer's reservations; list and
confirm only the requester's active upcoming ones appear, in order.

### Tests for User Story 2

- [ ] T028 [US2] `src/reservations/reservations.service.spec.ts` (not `[P]`: shares a file with T020, T021, T033, T034): active-list filtering — excludes cancelled, excludes already-ended, includes both `PENDING` and `CONFIRMED` (the clarified definition of active), returns `[]` rather than an error when empty.
- [ ] T029 [P] [US2] `test/reservations.e2e-spec.ts`: `GET /reservations/active` returns only the requester's reservations, ordered by `startTime` ascending, and never another customer's (SC-006). Also covers a reservation with `customerId = NULL`, which belongs to nobody and must not appear.

### Implementation for User Story 2

- [ ] T030 [US2] Add `findActiveByCustomer(customerId)` to `src/reservations/reservations.repository.ts` — `customerId` match, `status <> CANCELLED`, `endTime > now()`, ordered by `startTime` ascending, including the court for `courtName`.
- [ ] T031 [US2] Add `ReservationsService.listActive()` in `src/reservations/reservations.service.ts` returning mapped response DTOs.
- [ ] T032 [US2] Add `GET /reservations/active` to `src/reservations/reservations.controller.ts` — guard, `@CurrentCustomer()`, 200 with an array. No query parameters, no pagination.

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 - Cancel one of my reservations (Priority: P3)

**Goal**: An owner can cancel a not-yet-started active reservation, freeing the
slot; everyone else and every other state is refused.

**Independent Test**: Seed reservations across owners and states; attempt to
cancel each and confirm only the legal one succeeds, the slot becomes
re-bookable, and each illegal attempt is refused distinctly.

### Tests for User Story 3

- [ ] T033 [US3] `src/reservations/reservations.service.spec.ts` (not `[P]`: shares a file with T020, T021, T028, T034): **BR-09** — cancelling an already-cancelled reservation is refused and the row stays cancelled; cancelling an active one succeeds.
- [ ] T034 [US3] `src/reservations/reservations.service.spec.ts` (not `[P]`: shares a file with T020, T021, T028, T033): **BR-10** — cancelling a reservation whose start has passed is refused, both while still running and long finished; a reservation starting in one minute is still cancellable (BR-04's window is out of scope). Also assert **FR-016**: cancelling an id that does not exist is refused as not found.
- [ ] T035 [P] [US3] `test/reservations.e2e-spec.ts`: **BR-08** — customer B cancelling customer A's reservation gets 404, not 403, and the body reveals nothing about the reservation (FR-013); A's reservation remains active. Real Postgres (§III, ownership is listed as integration-tested).
- [ ] T036 [P] [US3] `test/reservations.e2e-spec.ts`: **SC-005** — after a successful cancel, an immediate re-book of the same court and slot succeeds, proving the exclusion constraint's `WHERE` predicate releases the row.

### Implementation for User Story 3

- [ ] T037 [US3] Add `findByIdForOwner(id, customerId)` and `cancel(id)` to `src/reservations/reservations.repository.ts`; `cancel` updates `status` to `CANCELLED` and does not delete the row.
- [ ] T038 [US3] Add `ReservationsService.cancel()` in `src/reservations/reservations.service.ts` with the guard order from data-model.md: exists (404) → owned, BR-08 (404, never 403) → active, BR-09 (409) → not yet started, BR-10 (409).
- [ ] T039 [US3] Add `POST /reservations/:id/cancel` to `src/reservations/reservations.controller.ts` — guard, UUID param validation, 200 with the updated reservation. `POST` not `DELETE`: the row is retained (contracts/reservations-api.md).

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T040 Verify rule-to-test traceability: `grep -rEo 'BR-(01|02|03|06|07|08|09|10)' src test | sort -u` must yield all 8 IDs. Fewer is a §III violation, not a coverage gap.
- [ ] T041 Run the negative control from quickstart.md: drop `Reservation_no_overlap_per_court`, confirm the BR-01 concurrency test **fails**, then restore with `npx prisma migrate reset`. A test that passes without the constraint proves nothing (§III).
- [ ] T042 [P] Audit every error response across the three endpoints for leaked persistence detail — no SQLSTATE, SQL, constraint or table names, no Prisma text (§IV, SC-007).
- [ ] T043 Run `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` — all must pass before review.
- [ ] T044 Walk quickstart.md end to end against a running app and correct any drift between it and the shipped behaviour.
- [ ] T045 [P] Record follow-ups discovered but deliberately not done (§VI: report, never apply) — notably that `Reservation.customerId` stays nullable for legacy rows, that `Customer.reservationCount` is left unmaintained pending BR-05, and that `X-Customer-Id` must be replaced by real authentication before any public deployment.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T003)**: no dependencies.
- **Foundational (T004–T015)**: needs Setup. Blocks all stories. Within it,
  T004 → T005 → T006 → T007 is strictly sequential (schema before audit before
  migration before generate); T008–T012 and T015 are parallel; T013–T014 need
  T007 for generated types.
- **US1 (T016–T027)**: needs Foundational. **MVP.**
- **US2 (T028–T032)**: needs Foundational. Independent of US1 in code, though in
  practice you need US1 to create rows worth listing (its tests seed directly).
- **US3 (T033–T039)**: needs Foundational. T036 exercises the create path, so run
  it after US1.
- **Polish (T040–T045)**: needs all desired stories.

### Within Each User Story

Tests written and failing first → DTO/response → repository → service →
controller. Constitution §I ordering: repositories before services before
controllers.

### Parallel Opportunities

- T003 alongside T001–T002.
- T008, T010, T011, T012, T015 all in parallel once T007 lands.
- **Three shared files serialise most of the story work.** Only tasks touching
  genuinely separate files carry `[P]`:
  - `src/reservations/reservations.service.spec.ts` — T020, T021, T028, T033,
    T034. None are `[P]`.
  - `test/reservations.e2e-spec.ts` — T016, T017, T018, T029, T035, T036. Marked
    `[P]` because they are independent *tests*, but they append to one file, so
    separate agents must serialise the writes.
  - `reservations.repository.ts` (T025, T030, T037) and
    `reservations.controller.ts` (T027, T032, T039) likewise collide across
    stories.
- Genuinely parallel: T019 (its own DTO spec file), T022 (courts spec), T024
  (response DTO).
- With multiple developers, US1/US2/US3 can proceed after Foundational, but the
  file collisions above mean the repository, service-spec and controller edits
  must be sequenced regardless of who owns which story.

---

## Post-Analysis Revisions (2026-08-25)

`/speckit-analyze` found nine issues; all are resolved in the artifacts above.

- **U1 (HIGH)** — start alignment to `:00`/`:30` was being implemented with no
  requirement behind it. The product owner confirmed BR-02 means "duration is a
  multiple of 30 minutes" only, so the check, its `UNALIGNED_START` error code
  and its test were removed; spec.md FR-003 now states the start is
  unconstrained, and Story 1 gained a scenario asserting 18:10 is valid.
- **F1 (HIGH)** — five tasks marked `[P]` shared one spec file. `[P]` removed and
  the collision documented under Parallel Opportunities.
- **A1 (MEDIUM)** — the BR-02 CHECK compared seconds and rounded, so a 3600.4 s
  duration would have passed as a valid 60 minutes. Now compared in
  milliseconds, which is lossless at `Timestamptz(3)`, and T019 tests it.
- **C1/C2/C3 (MEDIUM)** — FR-007, FR-016, FR-019 and FR-009 had implementation
  tasks but no verification. Assertions added to T021, T034, T017 and T018.
- **F2/F3/D1 (LOW)** — BR-03's deliberate 400/409 split documented in the
  contract; a field/court + booking/reservation glossary added to spec.md;
  FR-018 and FR-019 reordered.

---

## Implementation Strategy

### MVP First

1. Setup (T001–T003)
2. Foundational (T004–T015) — **do not skip T005**; a pre-existing overlap makes
   T006 fail and is a human decision, not something to migrate around
3. US1 (T016–T027)
4. **STOP and validate**: BR-01 holds under 50 concurrent requests, all seven
   rejection paths distinct
5. Demo — a customer who can book a court already has the core service

### Incremental Delivery

Foundation → US1 (book) → US2 (see) → US3 (cancel), validating each before the
next. Each adds value without breaking the last.

---

## Notes

- One commit per task, Conventional Commits (§V). Branch
  `feat/001-court-reservations`. Never push to main, never `--no-verify`.
- Tests must fail before implementation. For BR-01 specifically, a test that
  passes with the constraint dropped is a defect — that is what T041 checks.
- Rule IDs appear verbatim in test titles; that traceability is the metric, not
  coverage (§III).
- Out of scope throughout: BR-04, BR-05, court management endpoints,
  rescheduling, payments, notifications. Report anything else you find; do not
  fix it (§VI).
