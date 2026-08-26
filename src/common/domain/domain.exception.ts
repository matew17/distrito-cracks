import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for every domain exception raised by a service.
 *
 * Carries the machine-readable `code` and (when applicable) the `rule`
 * (a BR-xx id from docs/business-rules.md) that was violated, alongside the
 * HTTP status the global exception filter (T009) must map it to. Subclasses
 * fix `code`, `rule` and `status` to the exact values documented in
 * specs/001-court-reservations/contracts/reservations-api.md — callers only
 * ever choose the human-readable `message`.
 *
 * Never carries Prisma text, SQL, constraint or table names (constitution
 * §IV) — only messages safe to return to a client.
 */
export abstract class DomainException extends HttpException {
  /** Machine-readable error code from the API contract's error table. */
  readonly code: string;

  /** BR-xx rule id, when the failure is a named business rule. Absent for
   *  failures that are not tied to a specific rule (e.g. "not found",
   *  "unauthenticated"). */
  readonly rule?: string;

  protected constructor(params: {
    code: string;
    rule?: string;
    status: HttpStatus;
    message: string;
  }) {
    super(params.message, params.status);
    this.code = params.code;
    this.rule = params.rule;
  }
}

/** BR-01 · 409 — slot taken by an active (non-cancelled) reservation. */
export class ReservationOverlapError extends DomainException {
  constructor(message = 'That time slot is already booked on this court.') {
    super({
      code: 'RESERVATION_OVERLAP',
      rule: 'BR-01',
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

/** BR-02 · 400 — not 60-180 minutes in whole 30-minute blocks. */
export class InvalidDurationError extends DomainException {
  constructor(
    message = 'Reservation duration must be between 60 and 180 minutes, in 30-minute increments.',
  ) {
    super({
      code: 'INVALID_DURATION',
      rule: 'BR-02',
      status: HttpStatus.BAD_REQUEST,
      message,
    });
  }
}

/** BR-03 · 409 — the slot falls outside that weekday's configured window. */
export class OutsideOperatingHoursError extends DomainException {
  constructor(
    message = "That time is outside the court's operating hours for this day.",
  ) {
    super({
      code: 'OUTSIDE_OPERATING_HOURS',
      rule: 'BR-03',
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

/** BR-03 · 409 — no operating hours are configured for that weekday. */
export class CourtClosedThatDayError extends DomainException {
  constructor(
    message = 'The court has no operating hours configured for this day.',
  ) {
    super({
      code: 'COURT_CLOSED_THAT_DAY',
      rule: 'BR-03',
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

/** BR-03 · 400 — start and end fall on different venue-local days. */
export class SpansDayBoundaryError extends DomainException {
  constructor(message = 'The start and end time must fall on the same day.') {
    super({
      code: 'SPANS_DAY_BOUNDARY',
      rule: 'BR-03',
      status: HttpStatus.BAD_REQUEST,
      message,
    });
  }
}

/** BR-06 · 400 — start is at or before now. */
export class StartInPastError extends DomainException {
  constructor(message = 'The reservation start time must be in the future.') {
    super({
      code: 'START_IN_PAST',
      rule: 'BR-06',
      status: HttpStatus.BAD_REQUEST,
      message,
    });
  }
}

/** BR-07 · 409 — the court is under maintenance. */
export class CourtUnderMaintenanceError extends DomainException {
  constructor(message = 'This court is currently under maintenance.') {
    super({
      code: 'COURT_UNDER_MAINTENANCE',
      rule: 'BR-07',
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

/** BR-07 · 409 — the court has been withdrawn from the catalogue. */
export class CourtNotBookableError extends DomainException {
  constructor(message = 'This court is no longer available for booking.') {
    super({
      code: 'COURT_NOT_BOOKABLE',
      rule: 'BR-07',
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

/** BR-09 · 409 — the reservation has already been cancelled. */
export class ReservationNotActiveError extends DomainException {
  constructor(message = 'This reservation has already been cancelled.') {
    super({
      code: 'RESERVATION_NOT_ACTIVE',
      rule: 'BR-09',
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

/** BR-10 · 409 — the reservation's start time has already passed. */
export class ReservationAlreadyStartedError extends DomainException {
  constructor(
    message = 'This reservation cannot be cancelled because it has already started.',
  ) {
    super({
      code: 'RESERVATION_ALREADY_STARTED',
      rule: 'BR-10',
      status: HttpStatus.CONFLICT,
      message,
    });
  }
}

/** 404 — no such court. Not tied to a specific BR-xx rule. */
export class CourtNotFoundError extends DomainException {
  constructor(message = 'No court was found with the given id.') {
    super({
      code: 'COURT_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
      message,
    });
  }
}

/**
 * BR-08 · 404 — no such reservation, or one that exists but is not owned by
 * the requester. Always 404, never 403: a non-owner must learn nothing about
 * the reservation's existence (FR-013).
 */
export class ReservationNotFoundError extends DomainException {
  constructor(message = 'No reservation was found with the given id.') {
    super({
      code: 'RESERVATION_NOT_FOUND',
      rule: 'BR-08',
      status: HttpStatus.NOT_FOUND,
      message,
    });
  }
}

/** 401 — the `X-Customer-Id` identity header is missing or unknown. Not tied
 *  to a specific BR-xx rule. */
export class UnauthenticatedError extends DomainException {
  constructor(message = 'Missing or unknown customer identity.') {
    super({
      code: 'UNAUTHENTICATED',
      status: HttpStatus.UNAUTHORIZED,
      message,
    });
  }
}
