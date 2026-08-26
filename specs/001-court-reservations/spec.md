# Feature Specification: Court Reservations

**Feature Branch**: `feat/001-court-reservations`

**Created**: 2026-08-25

**Status**: Approved — human gate, 2026-08-25 (`.sdd/config.json` →
`gates.specApproval: always_human`). Implementation not started.

**Input**: User description: "Módulo de reservas de canchas. Un usuario puede crear una reserva para una cancha en un rango de tiempo, listar sus reservas activas, y cancelar una reserva existente. Aplican las reglas BR-01, BR-02, BR-03, BR-06 y BR-07 de docs/business-rules.md. BR-04 y BR-05 quedan fuera de alcance en esta iteración." (enriched with BR-08, BR-09, BR-10, approved 2026-08-25)

## Clarifications

### Session 2026-08-25

- Q: Which reservation states count as "active", for both overlap blocking (BR-01) and the customer's list? → A: PENDING and CONFIRMED are both active; only CANCELLED is not
- Q: What state does a newly created reservation start in? → A: CONFIRMED
- Q: How are a court's operating hours (BR-03) modelled? → A: Per weekday — open/close times per day of week
- Q: How is "under maintenance" (BR-07) represented, given Court already has isActive? → A: A new dedicated maintenance field, separate from isActive

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reserve a court for a time range (Priority: P1)

A customer picks a court and a start/end time and requests a reservation. The
system accepts the reservation only if the slot is genuinely bookable: nobody
else already holds it, the duration is legal, the court is open and not under
maintenance, and the slot is in the future. Otherwise the customer is told
which condition failed.

**Why this priority**: This is the core value of the module. Without it the
other two stories have nothing to operate on. It alone is a viable MVP: a
customer who can book a court has received the product's central service.

**Independent Test**: Seed a court with operating hours and no reservations,
then request a valid future slot and confirm a reservation is created; then
replay each rejection condition (overlap, bad duration, outside hours, past
slot, court under maintenance) and confirm each is refused with a distinct,
actionable reason.

**Acceptance Scenarios**:

1. **Given** an open court with no reservations and Tuesday hours 08:00–22:00,
   **When** the customer requests Tuesday 18:00–19:30,
   **Then** the reservation is created in the confirmed state and returned with
   its state, court, time range and price.
2. **Given** a court with an active reservation tomorrow 18:00–19:30,
   **When** another customer requests tomorrow 19:00–20:00 on that court,
   **Then** the request is rejected as a conflict and no reservation is created
   *(BR-01)*.
3. **Given** a court with an active reservation tomorrow 18:00–19:30,
   **When** another customer requests tomorrow 19:30–21:00 on that court,
   **Then** the reservation is created — a booking ending exactly when another
   begins is not an overlap *(BR-01)*.
4. **Given** an open court, **When** the customer requests a 45-minute, a
   30-minute, a 75-minute or a 210-minute slot, **Then** each is rejected as an
   invalid duration *(BR-02)*.
5. **Given** an open court, **When** the customer requests a 90-minute slot
   starting at 18:10, **Then** the reservation is created — BR-02 constrains
   duration only, not where the slot starts *(BR-02)*.
6. **Given** a court whose Tuesday hours are 08:00–22:00, **When** the customer
   requests Tuesday 21:00–23:00 or Tuesday 06:00–07:30, **Then** the request is
   rejected as outside that day's operating hours *(BR-03)*.
7. **Given** a court open 08:00–22:00 on Tuesday but with no hours configured
   for Sunday, **When** the customer requests Sunday 18:00–19:30, **Then** the
   request is rejected because the court is closed that day *(BR-03)*.
8. **Given** the current time is today 15:00, **When** the customer requests
   today 14:00–15:30 or yesterday 18:00–19:00, **Then** the request is rejected
   as being in the past *(BR-06)*.
9. **Given** a court flagged as under maintenance, **When** the customer
   requests any otherwise-valid slot on it, **Then** the request is rejected
   because the court accepts no reservations *(BR-07)*.
10. **Given** an open court and an empty slot, **When** two customers request
    the exact same slot simultaneously, **Then** exactly one reservation is
    created and the other request is rejected as a conflict *(BR-01)*.
11. **Given** a court identifier that does not exist, **When** the customer
    requests a reservation on it, **Then** the request is rejected as not found
    and no reservation is created.

---

### User Story 2 - See my active reservations (Priority: P2)

A customer wants to know what they currently have booked, so they can show up
at the right court at the right time, or decide what to cancel.

**Why this priority**: Depends on Story 1 having produced reservations, and is
a prerequisite for a customer to act on Story 3 in practice. Read-only, so it
carries no invariants of its own.

**Independent Test**: Seed one customer with a mix of upcoming, cancelled and
already-finished reservations plus reservations belonging to a different
customer; request the list and confirm only the requester's active upcoming
reservations appear.

**Acceptance Scenarios**:

1. **Given** a customer with two upcoming active reservations, one cancelled
   reservation and one reservation that ended last week, **When** they list
   their active reservations, **Then** only the two upcoming active ones are
   returned.
2. **Given** two customers each holding active reservations, **When** customer A
   lists their active reservations, **Then** no reservation belonging to
   customer B is returned.
3. **Given** a customer with several active reservations, **When** they list
   them, **Then** the results are ordered by start time, earliest first.
4. **Given** a customer with no active reservations, **When** they list them,
   **Then** an empty list is returned rather than an error.

---

### User Story 3 - Cancel one of my reservations (Priority: P3)

A customer who can no longer attend cancels a reservation they hold. The slot
becomes bookable again for everyone else. A customer can only cancel their own
reservation, can only cancel it once, and cannot cancel a reservation that has
already started.

**Why this priority**: Valuable but not required for the module to deliver its
core service; a customer with no cancellation path still gets a usable booking
product. Sequenced last because it needs Stories 1 and 2 to be meaningful.

**Independent Test**: Seed reservations across owners and states, then attempt
cancellation of each and confirm exactly the legal one succeeds, the slot is
released for re-booking, and each illegal attempt is refused with a distinct
reason.

**Acceptance Scenarios**:

1. **Given** a customer holding an active reservation tomorrow 18:00–19:30,
   **When** they cancel it, **Then** it becomes cancelled and stops appearing in
   their active reservations.
2. **Given** a reservation was just cancelled, **When** any customer requests
   that same slot on that court, **Then** the new reservation is created — a
   cancelled reservation no longer blocks the slot *(BR-01)*.
3. **Given** an active reservation owned by customer B, **When** customer A
   attempts to cancel it, **Then** the attempt is refused and the reservation
   remains active *(BR-08)*.
4. **Given** a reservation that is already cancelled, **When** its owner
   attempts to cancel it again, **Then** the attempt is refused and the
   reservation stays cancelled *(BR-09)*.
5. **Given** a reservation whose start time has already passed — whether still
   running or long finished — **When** its owner attempts to cancel it, **Then**
   the attempt is refused *(BR-10)*.
6. **Given** a reservation identifier that does not exist, **When** a customer
   attempts to cancel it, **Then** the attempt is refused as not found.

---

### Edge Cases

- **Back-to-back bookings**: a slot starting exactly when another ends is
  legal; boundaries touch but do not overlap *(BR-01)*.
- **Simultaneous identical requests**: two concurrent requests for the same
  court and slot must not both succeed. This cannot be prevented by a
  check-then-write in application code alone *(BR-01)*.
- **Cancelled reservations do not block**: overlap is evaluated only against
  reservations in an active state *(BR-01, BR-09)*.
- **Slot straddling the current moment**: a slot that started in the past but
  ends in the future is a past slot and is rejected *(BR-06)*.
- **Slot ending exactly at closing time**: legal; the end boundary is inclusive
  of the closing instant *(BR-03)*.
- **Slot spanning midnight or a day boundary**: rejected in this iteration,
  since operating hours are expressed per weekday within a single day *(BR-03)*.
- **Weekday with no configured hours**: the court is closed that day and every
  request on it is refused, even if a neighbouring day would allow the same
  clock times *(BR-03)*.
- **Zero-length or inverted time range** (end before or equal to start):
  rejected as an invalid duration *(BR-02)*.
- **Maintenance flagged while reservations already exist**: existing
  reservations are left untouched; only new requests are refused *(BR-07)*.
- **Court exists with no operating hours at all**: no slot can satisfy BR-03, so
  every request on it is refused rather than silently allowed.
- **Court withdrawn from the catalogue**: refuses reservations for its own
  stated reason, separately from maintenance *(BR-07)*.
- **Cancelling a reservation that starts in one minute**: allowed in this
  iteration — the penalty window is BR-04 and out of scope; only a start time
  already in the past blocks cancellation *(BR-10)*.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Customers MUST be able to request a reservation for one court over
  an explicit start and end instant.
- **FR-002**: System MUST reject a reservation request whose time range overlaps
  any existing active reservation on the same court, and MUST guarantee this
  holds even when requests arrive concurrently. Touching boundaries (one range
  ending exactly when another starts) are not overlaps. *(BR-01)*
- **FR-003**: System MUST reject a reservation whose duration is under 60
  minutes, over 180 minutes, or not a whole multiple of 30 minutes. BR-02
  constrains **duration only** — the start instant is unrestricted, so a
  90-minute slot beginning at 18:10 is valid. *(BR-02)*
- **FR-004**: System MUST reject a reservation whose start or end falls outside
  the target court's operating hours for the weekday on which it falls. A
  weekday with no configured hours is closed, and every request on it is
  rejected. *(BR-03)*
- **FR-005**: System MUST reject a reservation whose start instant is at or
  before the current instant. *(BR-06)*
- **FR-006**: System MUST reject any reservation request for a court flagged as
  under maintenance. Maintenance is a state of its own, distinct from a court
  being withdrawn from the catalogue; both refuse reservations, and each gives
  its own reason. *(BR-07)*
- **FR-007**: System MUST reject a reservation request naming a court that does
  not exist.
- **FR-008**: Every rejection MUST tell the requester which condition failed, in
  terms they can act on, and MUST NOT expose internal database or persistence
  error text.
- **FR-009**: A rejected reservation request MUST leave no trace — no partial or
  placeholder reservation is persisted.
- **FR-010**: Customers MUST be able to list their own active reservations,
  ordered by start time ascending, returning an empty list when they hold none.
- **FR-011**: The active reservation list MUST exclude cancelled reservations and
  reservations that have already ended, and MUST exclude reservations belonging
  to any other customer.
- **FR-012**: Customers MUST be able to cancel a reservation they own, after
  which the reservation no longer counts as active and no longer blocks its slot
  for other customers. *(BR-01, BR-09)*
- **FR-013**: System MUST refuse a cancellation requested by anyone other than
  the reservation's owner, and MUST NOT reveal details of a reservation the
  requester does not own. *(BR-08)*
- **FR-014**: System MUST refuse to cancel a reservation that is not in an active
  state, including one already cancelled. *(BR-09)*
- **FR-015**: System MUST refuse to cancel a reservation whose start instant has
  already passed. *(BR-10)*
- **FR-016**: System MUST refuse a cancellation naming a reservation that does
  not exist.
- **FR-017**: A court MUST carry per-weekday operating hours as needed by FR-004
  and a maintenance state as needed by FR-006. Managing those values is out of
  scope for this iteration; they are read, not edited, here.
- **FR-018**: Every one of BR-01, BR-02, BR-03, BR-06, BR-07, BR-08, BR-09 and
  BR-10 MUST have at least one automated test that names its rule ID, and BR-01
  MUST be exercised against a real database rather than a substitute.
- **FR-019**: A reservation MUST be created in the confirmed state. A reservation
  in either the pending or the confirmed state counts as active for FR-002,
  FR-011 and FR-014; only a cancelled reservation does not. Pending remains a
  valid stored state — existing records may hold it — but nothing in this
  iteration creates one.

### Glossary

`docs/business-rules.md` says **field** and **booking**; this spec, the plan and
the Prisma models say **court** and **reservation**. They are the same things —
`field` = `court` = `Court`, `booking` = `reservation` = `Reservation`. The code
names win here because they already exist in `prisma/schema.prisma`; the rule IDs
remain the single source of truth for the rules themselves.

### Key Entities

- **Customer**: the person holding reservations. Identified by name and phone.
  Owns zero or more reservations. Ownership is what FR-013 checks.
- **Court**: a bookable football field. Has a name, a catalogue state (listed vs
  withdrawn), a maintenance state independent of it, and per-weekday operating
  hours giving the window on each day of the week during which reservations may
  start and end. A weekday with no hours is closed.
- **Reservation**: a claim by one customer on one court for a time range. Has a
  start instant, an end instant, a state (pending, confirmed or cancelled) and a
  price. Pending and confirmed are both active; cancelled is not. Its state and
  time range together determine whether it blocks the slot for others and
  whether it appears in the owner's active list.

### Out of Scope

- **BR-04** — cancellation penalty and the 24-hour free-cancellation window. No
  penalty is computed or charged in this iteration.
- **BR-05** — the limit of 3 active reservations per customer. No per-customer
  cap is enforced in this iteration.
- Creating, editing or deleting courts, including setting operating hours and
  toggling maintenance.
- Rescheduling or modifying an existing reservation; a customer cancels and
  books again.
- Payment, invoicing and pricing rules beyond storing the price already carried
  by a reservation.
- Recurring and training reservations.
- Notifications of any kind.
- Any administrator or staff view over another customer's reservations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A customer can go from choosing a court to holding a confirmed
  reservation in a single request, with no follow-up step required.
- **SC-002**: Zero double-booked slots. Under 50 simultaneous requests for the
  same court and slot, exactly one succeeds and 49 are refused as conflicts,
  repeatably.
- **SC-003**: Every rejected request names the failed condition; a reviewer
  reading a rejection can tell which of the eight rules refused it without
  consulting logs.
- **SC-004**: 100% of the eight in-scope rules are traceable to at least one
  test naming the rule ID, verified by searching the test suite for each ID.
- **SC-005**: A cancelled slot is immediately re-bookable — a request for it
  placed right after the cancellation succeeds.
- **SC-006**: A customer never sees another customer's reservation, in either
  the active list or any cancellation response.
- **SC-007**: No rejection response contains persistence-layer or database
  error text.

## Assumptions

Choices made where the description was silent. The four highest-impact ones were
confirmed with the product owner on 2026-08-25 and are recorded under
Clarifications; what remains below are defaults still taken on our own judgement.

- The requester is an authenticated customer, and the customer whose
  reservations are listed or cancelled is always the requester — never a
  customer named in the request payload. This is what makes FR-013 enforceable.
- Times are exchanged as absolute instants including offset. Operating hours and
  the weekday a reservation falls on are both interpreted in the venue's local
  timezone, which is the same for every court.
- A reservation covers exactly one court; multi-court bookings are not
  expressible.
- Price comes from the existing default carried by a reservation; this iteration
  does not compute it from duration.
- The existing `Customer`, `Court` and `Reservation` entities are extended
  rather than replaced, and existing reservation data remains valid.
- Requests come from a small user base at venue scale (tens of concurrent
  users), so correctness under concurrency matters far more than throughput.
