# Phase 0 Research: Court Reservations

Decisions taken before design, with the alternatives that lost. Anything marked
**VERIFY** is a claim the implementation must confirm empirically rather than
trust — each has a task attached in tasks.md.

---

## R1. How BR-01 is enforced in Postgres

**Decision**: A partial exclusion constraint on `Reservation`:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_no_overlap_per_court"
  EXCLUDE USING gist (
    "courtId" WITH =,
    tstzrange("startTime", "endTime", '[)') WITH &&
  )
  WHERE ("status" <> 'CANCELLED');
```

**Rationale**:

- `btree_gist` is required because `courtId` is `TEXT` and plain GiST has no
  equality operator class for it. It ships with the standard `postgres:15` image
  used by `docker-compose.yml`, so `CREATE EXTENSION` succeeds without extra
  install steps.
- `'[)'` bounds — start inclusive, end exclusive — make a booking that starts
  exactly when another ends *not* an overlap, which is the behaviour Story 1
  scenario 3 requires. With `'[]'` bounds, back-to-back bookings would be
  rejected.
- The `WHERE ("status" <> 'CANCELLED')` predicate is what implements the
  clarified definition of "active": `PENDING` and `CONFIRMED` both block a slot,
  `CANCELLED` does not, so cancelling frees the slot with a plain status update
  and no row deletion.
- The constraint doubles as the index that makes the service's pre-check fast.

**Alternatives rejected**:

- **`@@unique([courtId, startTime])` in Prisma** — only catches identical start
  times. 18:00–19:30 and 19:00–20:00 would both commit. Fails scenario 2.
- **Service-level `findFirst` then `create`** — two statements, no lock between
  them. Under two concurrent requests both find the slot free and both insert.
  This is exactly what SC-002 tests, so it would fail visibly.
- **`SELECT ... FOR UPDATE` on the court row** — serialises all bookings for a
  court through one lock. It would work, but it puts the invariant in
  application code, which §II forbids, and it silently serialises unrelated
  time slots.
- **`SERIALIZABLE` isolation** — correct, but pushes retry handling into every
  caller and still leaves the table without a stated invariant.

**Consequence for the service**: the service keeps a pre-flight overlap query so
the common case yields a clear "that slot is taken" message, but it is an
optimisation, not the guarantee. The insert must still be wrapped (see R2).

---

## R2. Translating the constraint violation without leaking Prisma text

**Decision**: `ReservationsRepository.create()` wraps the insert in a try/catch,
detects the Postgres exclusion-violation SQLSTATE `23P01`, and throws the domain
error `ReservationOverlapError`. Detection reads the SQLSTATE defensively from
both places it can appear:

- `PrismaClientKnownRequestError` — inspect `meta` / `message` for `23P01`
- the raw driver error surfaced by `@prisma/adapter-pg` — a `pg` error carries
  `code === '23P01'` directly

**VERIFY**: Prisma has a mapped error code for unique violations (`P2002`) but no
dedicated code for exclusion violations, and with the driver-adapter path in
Prisma 7 the failure may surface as `PrismaClientUnknownRequestError` wrapping
the `pg` error instead of a known-request error. The exact shape must be asserted
in an integration test that provokes a real violation, rather than assumed — a
detector matching on the wrong field would silently turn a 409 into a 500. The
test asserts both the resulting HTTP status *and* that the response body contains
no `23P01`, no SQL, and no table names.

**Rationale**: §IV forbids Prisma messages reaching clients, and a bare
constraint violation is the single most likely place for one to escape.

**Alternative rejected**: letting the violation bubble to a generic 500 handler.
Cheaper, but it reports a lost race as a server fault, which breaks SC-003 (the
caller cannot tell which rule refused them).

---

## R3. Representing per-weekday operating hours

**Decision**: A new `CourtOperatingHour` table — one row per court per weekday —
with `dayOfWeek` as a `0..6` integer and `opensAt` / `closesAt` as **minutes from
midnight** (`0..1440`). Unique on `(courtId, dayOfWeek)`. **A missing row means
the court is closed that day**, which is exactly the semantics the clarification
asked for, with no extra "isClosed" flag to keep consistent.

`0 = Sunday`, matching both JavaScript's `Date.getDay()` and Postgres
`EXTRACT(DOW)`, so no translation layer is needed on either side.

**Rationale for minutes-as-integer over `TIME`**:

- Comparison is plain integer arithmetic — no timezone semantics attached to a
  bare `TIME`, which is a recurring source of off-by-one-hour bugs.
- `closesAt = 1440` cleanly expresses "open until midnight", which `TIME` cannot
  represent without wrapping to `00:00` and inverting every comparison.
- A `CHECK (opensAt >= 0 AND closesAt <= 1440 AND opensAt < closesAt)` makes a
  nonsensical window unrepresentable.

**Alternatives rejected**:

- **Two columns on `Court`** (single window for all days) — the clarification
  explicitly chose per-weekday.
- **`TIME` columns** — see above; also complicates the closed-day case.
- **A cron-like or interval spec** — far more expressive than BR-03 needs.

**Scope note**: this table is *read* here. Managing it is out of scope, so
seeding is a test/quickstart concern, not an endpoint.

---

## R4. Evaluating "the day's operating hours" and "the past"

**Decision**: Reservations are stored as absolute `TIMESTAMPTZ(3)`. To evaluate
BR-03, the start and end instants are converted to the venue's local weekday and
minutes-of-day using `Intl.DateTimeFormat` with an explicit `timeZone`, read from
config (`VENUE_TIMEZONE`, defaulting to `America/Bogota` — consistent with the
existing `price` default of 140000 COP). Helper: `src/common/time/venue-time.ts`.

BR-06 ("not in the past") compares the start instant against `new Date()` —
absolute instants, no timezone reasoning required.

**Rationale**: No new dependency. Node's bundled ICU handles named zones and DST
correctly, and pinning the zone in config keeps the rule from silently changing
behaviour when the server's `TZ` differs between a developer laptop and the
deployed container — a real risk here, since the rule's outcome depends on it.

**Alternatives rejected**:

- **`date-fns-tz` / `luxon`** — a dependency for what is two small functions.
  Reconsider if date maths grows past this feature.
- **Relying on the process `TZ`** — makes BR-03 environment-dependent, so the
  same request could pass locally and fail in CI.
- **Storing hours per-court in the court's own timezone** — no multi-venue
  requirement exists; a single venue zone is assumed and recorded in spec.md.

**Consequence**: a reservation may not span a day boundary in venue-local time.
The spec's Edge Cases already rejects midnight-spanning slots, so the service
rejects any request whose start and end fall on different local weekdays.

---

## R5. Where the requester's identity comes from

**Decision**: A `CurrentCustomerGuard` reads an `X-Customer-Id` request header,
loads that `Customer`, and attaches it to the request; a `@CurrentCustomer()`
parameter decorator hands the resolved customer to controllers. An unknown or
missing value is a 401. `customerId` is **never** read from a request body or
route parameter.

**Rationale**: BR-08 ("only the owner may cancel") is meaningless unless the
identity is something the caller cannot assert freely. This repo has no
authentication module — `src/app.module.ts` wires only `PrismaModule` — and
building one is a separate feature. The guard is deliberately a thin, clearly
labelled seam: replacing the header lookup with real token verification later
touches one file and no business logic.

**This is a stated assumption, not a security claim.** `X-Customer-Id` is
trivially spoofable and is acceptable only because no authentication exists yet
in this codebase. It must not ship to a public environment as-is. The guard file
carries that warning in a comment, and it is called out again in quickstart.md.

**Alternatives rejected**:

- **`customerId` in the POST body / cancel route** — reduces BR-08 to a
  formality; a caller could cancel anyone's booking by changing one field. This
  is the failure mode BR-08 was added to prevent.
- **Implementing JWT auth now** — out of scope (§VI), and it would expand this
  feature into an auth feature.

---

## R6. Adding the constraints to a table with no rows

**Decision**: Both constraints are added **fully validated**. The `Reservation`
table is confirmed empty (product owner, 2026-08-25), so there is no legacy data
to accommodate.

**Rationale**:

- An empty table removes the only reason to weaken either constraint. An earlier
  draft added the BR-02 `CHECK` as `NOT VALID` to grandfather rows predating the
  duration rule — e.g. 45- or 210-minute slots, or `isRecurring`/`isTraining`
  rows from flows outside this scope. With no such rows, `NOT VALID` would buy
  nothing and leave a permanently unvalidated constraint behind, which is a worse
  §II outcome than simply enforcing it.
- `ALTER TABLE ... ADD CONSTRAINT ... EXCLUDE` fails outright if existing rows
  overlap, and Postgres has no `NOT VALID` for exclusion constraints — so BR-01
  was always going to be validated on creation regardless.

**Still run the audit.** The overlap detection query in quickstart.md stays in
the task list (T005) even though it is expected to return zero rows. It costs one
query, and it is the difference between *knowing* the table is empty at migration
time and *assuming* it — if anything seeds data before this ships, a real overlap
would abort the migration with a constraint error instead of a clear report.

**Consequence if this assumption turns out wrong**: the migration fails loudly
rather than corrupting anything. Resolving pre-existing overlaps would then be a
human decision, since rewriting data this feature did not create is out of scope
(§VI).

---

## R7. Proving BR-01 under concurrency

**Decision**: An e2e test in `test/reservations.e2e-spec.ts` fires N concurrent
`POST /reservations` for the identical court and slot with `Promise.allSettled`,
then asserts exactly one 201 and N−1 409s, and that the table holds exactly one
active row for that slot. It runs against the Docker Postgres, using the real
`PrismaService`.

**Rationale**: §III requires overlap rules to be tested against real Postgres,
never a mocked client — and a mock cannot exhibit the race at all, so a passing
mocked test would be precisely the "test that passes when its rule is broken"
that §III calls a defect. SC-002 fixes the count at 50 concurrent requests.

**Note on `N`**: 50 concurrent requests need 50 usable connections at once, or
they queue. Queuing is harmless for correctness here — the assertion is about
outcomes, not timing — so the pool is left at its default rather than tuned.

**Alternatives rejected**:

- **Mocked Prisma client** — forbidden by §III, and cannot reproduce a race.
- **Sequential requests** — proves the pre-check, not the constraint. It would
  pass even if the exclusion constraint were missing entirely, which is the
  defect §III warns about.

---

## R8. Rule-by-rule placement

| Rule | Placement | Why not in the database |
|------|-----------|------------------------|
| BR-01 overlap | **DB** exclusion constraint (+ service pre-check for messaging) | — it is in the DB |
| BR-02 duration (60–180 min, whole 30-min blocks; **start unconstrained**) | **DB** `CHECK` (validated) + DTO validator | — it is in the DB; DTO added so the caller gets a field-level message |
| BR-03 operating hours | Service | Cross-table (`Reservation` → `CourtOperatingHour`) and timezone-dependent; a `CHECK` cannot read another table |
| BR-06 no past slots | Service (+ DTO shape checks) | Depends on `now()`, which is not immutable, so it cannot appear in a `CHECK` constraint |
| BR-07 maintenance | Service | Depends on the parent `Court` row's current state; a trigger could do it, but a trigger is business logic hidden from the service layer |
| BR-08 ownership | Service (guard supplies identity) | Depends on the requester, which the database has no knowledge of |
| BR-09 active-status transition | Service | Expressible only as a trigger on `UPDATE`; kept in the service so the refusal reason is explicit |
| BR-10 start already passed | Service | Depends on `now()` — same reason as BR-06 |

The pattern: static, single-row, time-independent invariants go to Postgres.
Anything depending on `now()`, another table, or the caller stays in the service,
where it can produce a specific, actionable refusal.
