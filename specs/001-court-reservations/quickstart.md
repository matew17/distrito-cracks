# Quickstart: Validating Court Reservations

How to prove this feature works end to end. Details live in
[data-model.md](./data-model.md) and
[contracts/reservations-api.md](./contracts/reservations-api.md); this file is
the run guide.

## Prerequisites

```bash
npm install                 # class-validator ^0.15.1 + class-transformer ^0.5.1 are added by this feature (T001)
npm run db:up               # Postgres 15 on :5432, per docker-compose.yml
cp .env.example .env        # DATABASE_URL; set VENUE_TIMEZONE (default America/Bogota)
```

## Before migrating: check for pre-existing overlaps

The `Reservation` table is confirmed empty as of 2026-08-25, so this is expected
to return nothing — run it anyway. The BR-01 exclusion constraint validates on
creation and **cannot** be deferred with `NOT VALID`, so if the table has been
seeded since and holds two overlapping active reservations, the migration fails
with a constraint error instead of a readable report. One query buys that
difference:

```sql
SELECT a.id, b.id, a."courtId", a."startTime", a."endTime", b."startTime", b."endTime"
FROM "Reservation" a
JOIN "Reservation" b
  ON a."courtId" = b."courtId"
 AND a.id < b.id
 AND tstzrange(a."startTime", a."endTime", '[)')
  && tstzrange(b."startTime", b."endTime", '[)')
WHERE a.status <> 'CANCELLED' AND b.status <> 'CANCELLED';
```

Zero rows → proceed. Any rows → **stop and report them**. They are pre-existing
data this feature is not authorised to rewrite (§VI); the fix is a decision for a
human, not the migration.

## Migrate and generate

```bash
npx prisma migrate dev --name court_reservations --create-only   # DDL only
# then append the raw SQL from data-model.md to the generated migration.sql
npx prisma migrate dev                                            # apply
npx prisma generate
```

The raw SQL must be appended by hand because Prisma cannot express
`EXCLUDE USING gist`. Both go in one migration, in one commit (§II).

## Seed a bookable court

Reservations need a court with operating hours; managing courts is out of scope,
so seed directly:

```sql
INSERT INTO "Court" (id, name, "isActive", "underMaintenance", "createdAt", "updatedAt")
VALUES ('11111111-1111-1111-1111-111111111111', 'Cancha 1', true, false, now(), now());

-- open 08:00-22:00 every day EXCEPT Sunday (dayOfWeek 0), left closed on purpose
INSERT INTO "CourtOperatingHour" (id, "courtId", "dayOfWeek", "opensAt", "closesAt")
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', d, 480, 1320
FROM generate_series(1, 6) AS d;

INSERT INTO "Customer" (id, name, phone, "createdAt", "updatedAt")
VALUES ('22222222-2222-2222-2222-222222222222', 'Ana', '+573001112233', now(), now()),
       ('33333333-3333-3333-3333-333333333333', 'Beto', '+573004445566', now(), now());
```

Leaving Sunday with no row is the closed-day case — a missing row *is* "closed".

## Manual walkthrough

```bash
npm run start:dev
```

Replace the timestamps with a future weekday slot in venue-local time.

```bash
# 1. Book a slot -> 201 CONFIRMED
curl -si -X POST localhost:3000/reservations \
  -H 'Content-Type: application/json' -H 'X-Customer-Id: 22222222-2222-2222-2222-222222222222' \
  -d '{"courtId":"11111111-1111-1111-1111-111111111111","startTime":"2026-09-01T18:00:00.000-05:00","endTime":"2026-09-01T19:30:00.000-05:00"}'

# 2. BR-01 overlap -> 409 RESERVATION_OVERLAP
#    (19:00-20:00 straddles the booking above)
# 3. BR-01 back-to-back -> 201  (19:30-21:00 is NOT an overlap)
# 4. BR-02 -> 400 INVALID_DURATION (45 min, 75 min, 210 min)
#    ...and 18:10-19:40 -> 201: BR-02 constrains duration only, not the start
# 5. BR-03 -> 409 OUTSIDE_OPERATING_HOURS (21:00-23:00), COURT_CLOSED_THAT_DAY (a Sunday)
# 6. BR-06 -> 400 START_IN_PAST (yesterday)
# 7. BR-07 -> 409 COURT_UNDER_MAINTENANCE (after UPDATE "Court" SET "underMaintenance" = true)

# 8. List own active -> 200, ordered by startTime, Beto's bookings absent
curl -si localhost:3000/reservations/active -H 'X-Customer-Id: 22222222-2222-2222-2222-222222222222'

# 9. BR-08 -> 404 RESERVATION_NOT_FOUND (Beto cancelling Ana's reservation)
curl -si -X POST localhost:3000/reservations/<ana-reservation-id>/cancel \
  -H 'X-Customer-Id: 33333333-3333-3333-3333-333333333333'

# 10. Cancel as owner -> 200 CANCELLED; then re-book the freed slot -> 201 (SC-005)
# 11. BR-09 -> 409 RESERVATION_NOT_ACTIVE (cancel the same one twice)
# 12. BR-10 -> 409 RESERVATION_ALREADY_STARTED (a row whose startTime is in the past)
```

`X-Customer-Id` is a placeholder for real authentication and is trivially
spoofable. It exists because this codebase has no auth module yet (research.md
R5). **Do not deploy it to a public environment.**

## Automated validation

```bash
npm run lint
npm run build
npm test          # unit: BR-02, BR-03, BR-06, BR-07, BR-08, BR-09, BR-10
npm run test:e2e  # integration: BR-01 against real Postgres, plus HTTP mapping
```

Rule-to-test traceability is the metric (§III), so every rule ID must appear in a
test title. Verify with:

```bash
grep -rEo 'BR-(01|02|03|06|07|08|09|10)' src test | sort -u | wc -l   # expect 8
```

Fewer than 8 means a rule has no test naming it — a constitution violation, not a
coverage gap.

## The one test that matters most

BR-01 under concurrency (SC-002): 50 simultaneous requests for the same court and
slot, expecting exactly one `201` and 49 `409`s.

```bash
npm run test:e2e -- --testNamePattern 'BR-01'
```

To confirm the test is real rather than self-fulfilling, drop the exclusion
constraint and re-run — it **must** fail:

```sql
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_no_overlap_per_court";
```

A test that still passes without the constraint is proving nothing, which §III
classes as a defect. Restore with `npx prisma migrate reset`.
