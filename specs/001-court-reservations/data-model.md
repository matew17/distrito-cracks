# Phase 1 Data Model: Court Reservations

Changes to `prisma/schema.prisma`, plus the raw SQL Prisma cannot express. The
applied migration `20260825163757_init` is never edited; everything below lands
in one new migration.

---

## Court (modified)

| Field | Type | Change | Purpose |
|-------|------|--------|---------|
| `id` | `String @id @default(uuid())` | — | |
| `name` | `String @unique` | — | |
| `isActive` | `Boolean @default(true)` | unchanged meaning | Listed in the catalogue vs withdrawn |
| `underMaintenance` | `Boolean @default(false)` | **new** | BR-07. Temporarily unusable, distinct from withdrawn |
| `operatingHours` | `CourtOperatingHour[]` | **new relation** | BR-03 |

The two flags are deliberately independent — the clarification chose a dedicated
field so "closed for repairs this week" and "retired from the catalogue" stay
distinguishable. A court is bookable only when `isActive = true AND
underMaintenance = false`; each false condition yields its own refusal reason.

`@default(false)` means existing court rows migrate to "not under maintenance",
which is the safe direction: no currently-bookable court silently stops
accepting reservations.

---

## CourtOperatingHour (new)

| Field | Type | Constraints | Purpose |
|-------|------|-------------|---------|
| `id` | `String @id @default(uuid())` | | |
| `courtId` | `String` | FK → `Court.id`, `onDelete: Cascade` | Owner |
| `dayOfWeek` | `Int` | `0..6`, `0 = Sunday` | Matches JS `getDay()` and Postgres `EXTRACT(DOW)` |
| `opensAt` | `Int` | minutes from midnight, `0..1440` | Window start |
| `closesAt` | `Int` | minutes from midnight, `0..1440` | Window end |

- `@@unique([courtId, dayOfWeek])` — one window per court per weekday.
- `CHECK ("dayOfWeek" BETWEEN 0 AND 6)`
- `CHECK ("opensAt" >= 0 AND "closesAt" <= 1440 AND "opensAt" < "closesAt")`

**A missing row means the court is closed that weekday.** This is the whole
representation of a closed day — there is no separate flag to contradict it.
`closesAt = 1440` expresses "open until midnight".

Cascade delete is safe: operating hours have no meaning without their court.

---

## Reservation (modified)

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `startTime` | `DateTime @db.Timestamptz(3)` | — | Absolute instant |
| `endTime` | `DateTime @db.Timestamptz(3)` | — | Absolute instant |
| `status` | `ReservationStatus @default(PENDING)` | **default changed to `CONFIRMED`** | Clarified: new reservations are created confirmed |
| `customerId` | `String?` | **stays nullable** | See below |
| `price`, `isRecurring`, `isTraining` | | untouched | Out of scope |

**Status.** The `ReservationStatus` enum is unchanged: `PENDING`, `CONFIRMED`,
`CANCELLED`. Both `PENDING` and `CONFIRMED` are *active* — they block a slot and
appear in the owner's list. `PENDING` becomes unreachable through this feature's
endpoints but stays valid as a stored state, since existing rows may hold it and
the enum is shared with flows outside this scope.

**Why `customerId` stays nullable.** Existing rows may have no customer (the
`init` migration made it nullable with `ON DELETE SET NULL`), and this feature is
not permitted to rewrite that history. Instead:

- The create path always sets `customerId` — a customer-created reservation
  without an owner is not producible through the API.
- BR-08 treats `customerId = NULL` as *owned by nobody*, so no customer can
  cancel such a row and it never appears in any customer's list.

Making the column `NOT NULL` would require either deleting or inventing owners
for legacy rows. That is out of scope (§VI) and is called out as a follow-up.

### Raw SQL for this table

```sql
-- BR-01: no two active reservations overlap on the same court.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_no_overlap_per_court"
  EXCLUDE USING gist (
    "courtId" WITH =,
    tstzrange("startTime", "endTime", '[)') WITH &&
  )
  WHERE ("status" <> 'CANCELLED');

-- BR-02: duration 60-180 minutes, in whole 30-minute blocks. Duration only —
-- the start instant is unconstrained. Compared in milliseconds so no rounding
-- can let a near-30-minute duration pass as an exact one.
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_duration_valid"
  CHECK (
    "endTime" > "startTime"
    AND (EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000)::bigint
        BETWEEN 3600000 AND 10800000
    AND MOD((EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000)::bigint, 1800000) = 0
  );
```

- `'[)'` bounds: a reservation ending exactly when another starts is **not** an
  overlap (Story 1 scenario 3).
- The `WHERE` predicate is what makes cancellation free a slot: flipping
  `status` to `CANCELLED` removes the row from the constraint's scope.
- Both constraints are added **validated**, not `NOT VALID`. An earlier draft
  planned `NOT VALID` on the CHECK to grandfather legacy rows; the database is
  confirmed empty (2026-08-25), so there is nothing to grandfather and the
  constraint can hold for every row unconditionally. The overlap audit in
  quickstart.md is still run first — it is a cheap confirmation, and if the
  table ever *is* populated before this ships, an existing overlap would abort
  the migration.
- Millisecond arithmetic matters: `Timestamptz(3)` means `EXTRACT(EPOCH …) *
  1000` is already a whole number, so the `::bigint` cast is lossless. Comparing
  in seconds instead would round, and a duration of 3600.4 s would pass as a
  valid 60 minutes.
- There is no start-alignment constraint. BR-02 governs duration only, so
  `18:10 → 19:40` is valid (spec.md FR-003). The DTO computes the same
  millisecond difference, so the two checks agree exactly.

---

## Customer (untouched)

Read only, to resolve the requester and to own reservations. `reservationCount`
is **not** maintained by this feature — it relates to BR-05, which is out of
scope, and incrementing it here would create a counter nothing keeps correct.

---

## State transitions

```text
                    (create)
                       │
                       ▼
                   CONFIRMED ──────cancel──────▶ CANCELLED
                       ▲                             │
                       │                             │ terminal
   PENDING ────cancel──┘ (legacy rows only)          ✗ no further transition
```

Guards on the `cancel` edge, in evaluation order — each maps to a distinct
refusal so SC-003 holds:

1. Reservation exists, else not-found.
2. **BR-08** — requester owns it, else not-found (*not* forbidden: FR-013 says a
   non-owner must learn nothing about the reservation, and a 403 would confirm
   it exists).
3. **BR-09** — current status is active, else conflict.
4. **BR-10** — `startTime > now()`, else conflict.

There is no transition out of `CANCELLED`; re-booking a freed slot creates a new
reservation, since rescheduling is out of scope.

---

## Rule-to-artifact map

| Rule | Enforced by |
|------|-------------|
| BR-01 | `Reservation_no_overlap_per_court` exclusion constraint (+ service pre-check for the message) |
| BR-02 | `Reservation_duration_valid` CHECK + `CreateReservationDto` |
| BR-03 | `CourtsService` reading `CourtOperatingHour` for the venue-local weekday |
| BR-06 | `ReservationsService` comparing `startTime` to now |
| BR-07 | `CourtsService` reading `Court.underMaintenance` (and `isActive`) |
| BR-08 | `ReservationsService` comparing `customerId` to the guard-resolved requester |
| BR-09 | `ReservationsService` status check before the update |
| BR-10 | `ReservationsService` comparing `startTime` to now |
