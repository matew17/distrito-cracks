# Contract: Reservations API

Three endpoints. All require the requester identity header; none accepts a
customer id in its payload (see research.md R5).

**Identity header (all endpoints)**

```http
X-Customer-Id: <customer uuid>
```

Missing or unknown → `401`. Placeholder for real authentication; see research.md
R5 for why this is acceptable now and what it must not become.

---

## Error envelope

Every failure returns this shape. `rule` is present when a business rule refused
the request, and is what makes SC-003 checkable.

```json
{
  "statusCode": 409,
  "code": "RESERVATION_OVERLAP",
  "rule": "BR-01",
  "message": "That time slot is already booked on this court."
}
```

No response body may contain SQL, a constraint name, a table name, a SQLSTATE, or
any Prisma text (constitution §IV). The global filter's catch-all logs the real
error server-side and returns a generic `500` with no `rule`.

| `code` | Status | Rule | Meaning |
|--------|--------|------|---------|
| `RESERVATION_OVERLAP` | 409 | BR-01 | Slot taken by an active reservation |
| `INVALID_DURATION` | 400 | BR-02 | Not 60–180 min in whole 30-min blocks |
| `OUTSIDE_OPERATING_HOURS` | 409 | BR-03 | Outside that weekday's window |
| `COURT_CLOSED_THAT_DAY` | 409 | BR-03 | No hours configured for that weekday |
| `SPANS_DAY_BOUNDARY` | 400 | BR-03 | Start and end fall on different venue-local days |
| `START_IN_PAST` | 400 | BR-06 | Start is at or before now |
| `COURT_UNDER_MAINTENANCE` | 409 | BR-07 | Court is under maintenance |
| `COURT_NOT_BOOKABLE` | 409 | BR-07 | Court withdrawn from the catalogue |
| `RESERVATION_NOT_ACTIVE` | 409 | BR-09 | Already cancelled |
| `RESERVATION_ALREADY_STARTED` | 409 | BR-10 | Start time has passed |
| `COURT_NOT_FOUND` | 404 | — | No such court |
| `RESERVATION_NOT_FOUND` | 404 | BR-08 | No such reservation **or** not owned by the requester |
| `UNAUTHENTICATED` | 401 | — | Identity header missing or unknown |

**Status-code choices.** `400` is for a payload wrong on its face — checkable
without touching the database. `409` is for a well-formed request that the
current state of the world refuses. BR-08 returns `404`, never `403`: FR-013
requires that a non-owner learn nothing, and `403` would confirm the reservation
exists.

**Why BR-03 spans both classes.** `SPANS_DAY_BOUNDARY` is `400` because it is
decidable from the payload alone; `OUTSIDE_OPERATING_HOURS` and
`COURT_CLOSED_THAT_DAY` are `409` because they depend on the court's configured
hours. One rule, two classes, on purpose — the `rule` field disambiguates, so
this is not an inconsistency to "fix" later.

**BR-02 constrains duration only.** There is no start-alignment rule: a
90-minute slot beginning at 18:10 is valid (spec.md FR-003). Durations are
compared at millisecond resolution so a sub-second discrepancy cannot masquerade
as a whole 30-minute block.

---

## POST /reservations

Create a reservation. *(Story 1)*

**Request**

```json
{
  "courtId": "2f6c...",
  "startTime": "2026-08-26T18:00:00.000-05:00",
  "endTime": "2026-08-26T19:30:00.000-05:00"
}
```

| Field | Validation |
|-------|-----------|
| `courtId` | required, UUID |
| `startTime` | required, ISO-8601 with offset |
| `endTime` | required, ISO-8601 with offset, after `startTime` |

Unknown properties are rejected (`ValidationPipe` with `forbidNonWhitelisted`),
so a caller cannot smuggle `customerId`, `status` or `price`.

**201 Created**

```json
{
  "id": "9ab1...",
  "courtId": "2f6c...",
  "courtName": "Cancha 1",
  "startTime": "2026-08-26T23:00:00.000Z",
  "endTime": "2026-08-27T00:30:00.000Z",
  "status": "CONFIRMED",
  "price": 140000
}
```

`customerId` is not echoed — it is always the requester. Timestamps are returned
as UTC instants; the client renders them in whatever zone it wants.

**Failures**: `400` `INVALID_DURATION`, `START_IN_PAST`,
`SPANS_DAY_BOUNDARY` · `404` `COURT_NOT_FOUND` · `409` `RESERVATION_OVERLAP`,
`OUTSIDE_OPERATING_HOURS`, `COURT_CLOSED_THAT_DAY`, `COURT_UNDER_MAINTENANCE`,
`COURT_NOT_BOOKABLE` · `401` `UNAUTHENTICATED`

**Evaluation order** — first failure wins, and the order is fixed so error
messages are predictable and testable:

1. DTO shape → `400`
2. Court exists → `404`
3. Court bookable (BR-07) → `409`
4. Not in the past (BR-06) → `400`
5. Within the weekday's hours (BR-03) → `409`
6. No overlap (BR-01): service pre-check → `409`; the DB constraint is the
   authority and produces the same `409` if the pre-check loses a race

BR-02 is checked twice — at the DTO (step 1) and by the DB CHECK. A caller only
ever sees the DTO message; the constraint is the backstop for non-HTTP writers.

---

## GET /reservations/active

The requester's own active reservations. *(Story 2)*

No query parameters. Returns only reservations where the requester is the owner,
the status is not `CANCELLED`, and `endTime > now()`. Ordered by `startTime`
ascending. No pagination — bounded in practice, and BR-05's cap is out of scope.

**200 OK**

```json
[
  {
    "id": "9ab1...",
    "courtId": "2f6c...",
    "courtName": "Cancha 1",
    "startTime": "2026-08-26T23:00:00.000Z",
    "endTime": "2026-08-27T00:30:00.000Z",
    "status": "CONFIRMED",
    "price": 140000
  }
]
```

An empty result is `200` with `[]`, never `404`.

**Failures**: `401` `UNAUTHENTICATED`

---

## POST /reservations/:id/cancel

Cancel a reservation the requester owns. *(Story 3)*

`POST …/cancel` rather than `DELETE`, because the row is retained with
`status = CANCELLED` — it is a state transition, not a deletion. No request body.

**200 OK** — the updated reservation, `status: "CANCELLED"`.

**Failures**: `404` `RESERVATION_NOT_FOUND` (absent **or** not owned — BR-08) ·
`409` `RESERVATION_NOT_ACTIVE` (BR-09), `RESERVATION_ALREADY_STARTED` (BR-10) ·
`401` `UNAUTHENTICATED`

Cancelling is not idempotent by design: a second call returns `409`
`RESERVATION_NOT_ACTIVE`, because FR-014 requires the attempt to be *refused*
rather than silently accepted.

After a successful cancel the slot is immediately bookable — the exclusion
constraint's `WHERE status <> 'CANCELLED'` predicate stops covering the row
(SC-005).

---

## Out of scope

No endpoints for creating or editing courts, setting operating hours, toggling
maintenance, rescheduling, listing past reservations, listing another customer's
reservations, or anything touching BR-04 (penalties) or BR-05 (per-customer cap).
