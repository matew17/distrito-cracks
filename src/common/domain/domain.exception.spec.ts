import { HttpException, HttpStatus } from '@nestjs/common';
import {
  DomainException,
  ReservationOverlapError,
  InvalidDurationError,
  OutsideOperatingHoursError,
  CourtClosedThatDayError,
  SpansDayBoundaryError,
  StartInPastError,
  CourtUnderMaintenanceError,
  CourtNotBookableError,
  ReservationNotActiveError,
  ReservationAlreadyStartedError,
  CourtNotFoundError,
  ReservationNotFoundError,
  UnauthenticatedError,
} from './domain.exception';

/**
 * Every row of the error table in
 * specs/001-court-reservations/contracts/reservations-api.md, transcribed
 * independently of src/common/domain/domain.exception.ts. If any subclass
 * ever drifts from this table, this spec must fail — that is the entire
 * point of pinning code/rule/status here rather than trusting the
 * constructor body by inspection.
 */
const CONTRACT_TABLE: Array<{
  ErrorClass: new (message?: string) => DomainException;
  code: string;
  status: HttpStatus;
  rule?: string;
}> = [
  {
    ErrorClass: ReservationOverlapError,
    code: 'RESERVATION_OVERLAP',
    status: HttpStatus.CONFLICT,
    rule: 'BR-01',
  },
  {
    ErrorClass: InvalidDurationError,
    code: 'INVALID_DURATION',
    status: HttpStatus.BAD_REQUEST,
    rule: 'BR-02',
  },
  {
    ErrorClass: OutsideOperatingHoursError,
    code: 'OUTSIDE_OPERATING_HOURS',
    status: HttpStatus.CONFLICT,
    rule: 'BR-03',
  },
  {
    ErrorClass: CourtClosedThatDayError,
    code: 'COURT_CLOSED_THAT_DAY',
    status: HttpStatus.CONFLICT,
    rule: 'BR-03',
  },
  {
    ErrorClass: SpansDayBoundaryError,
    code: 'SPANS_DAY_BOUNDARY',
    status: HttpStatus.BAD_REQUEST,
    rule: 'BR-03',
  },
  {
    ErrorClass: StartInPastError,
    code: 'START_IN_PAST',
    status: HttpStatus.BAD_REQUEST,
    rule: 'BR-06',
  },
  {
    ErrorClass: CourtUnderMaintenanceError,
    code: 'COURT_UNDER_MAINTENANCE',
    status: HttpStatus.CONFLICT,
    rule: 'BR-07',
  },
  {
    ErrorClass: CourtNotBookableError,
    code: 'COURT_NOT_BOOKABLE',
    status: HttpStatus.CONFLICT,
    rule: 'BR-07',
  },
  {
    ErrorClass: ReservationNotActiveError,
    code: 'RESERVATION_NOT_ACTIVE',
    status: HttpStatus.CONFLICT,
    rule: 'BR-09',
  },
  {
    ErrorClass: ReservationAlreadyStartedError,
    code: 'RESERVATION_ALREADY_STARTED',
    status: HttpStatus.CONFLICT,
    rule: 'BR-10',
  },
  {
    ErrorClass: CourtNotFoundError,
    code: 'COURT_NOT_FOUND',
    status: HttpStatus.NOT_FOUND,
    // no rule: not tied to a specific BR-xx
  },
  {
    ErrorClass: ReservationNotFoundError,
    code: 'RESERVATION_NOT_FOUND',
    status: HttpStatus.NOT_FOUND,
    rule: 'BR-08',
  },
  {
    ErrorClass: UnauthenticatedError,
    code: 'UNAUTHENTICATED',
    status: HttpStatus.UNAUTHORIZED,
    // no rule: not tied to a specific BR-xx
  },
];

describe('DomainException subclasses (contracts/reservations-api.md error table)', () => {
  it('the contract table used by this spec has exactly 13 rows', () => {
    // Guards against silently trimming this spec's own fixture instead of
    // fixing a real discrepancy.
    expect(CONTRACT_TABLE).toHaveLength(13);
  });

  it.each(CONTRACT_TABLE)(
    '$code: is a DomainException/HttpException with the documented code, rule and status',
    ({ ErrorClass, code, status, rule }) => {
      const error = new ErrorClass();

      expect(error).toBeInstanceOf(DomainException);
      expect(error).toBeInstanceOf(HttpException);
      expect(error.code).toBe(code);
      expect(error.rule).toBe(rule);
      expect(error.getStatus()).toBe(status);
    },
  );

  it('rows without a documented rule (COURT_NOT_FOUND, UNAUTHENTICATED) leave rule undefined', () => {
    expect(new CourtNotFoundError().rule).toBeUndefined();
    expect(new UnauthenticatedError().rule).toBeUndefined();
  });

  it('every code in the table is unique', () => {
    const codes = CONTRACT_TABLE.map((row) => row.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('all 409 rows correspond to a documented BR-xx rule, and all 400/404/401 rows either have one or are explicitly rule-less', () => {
    // Sanity check on the fixture itself matching the contract's own framing:
    // every CONFLICT (409) row in the table carries a rule id.
    const conflictRows = CONTRACT_TABLE.filter(
      (row) => row.status === HttpStatus.CONFLICT,
    );
    for (const row of conflictRows) {
      expect(row.rule).toMatch(/^BR-\d{2}$/);
    }
  });

  it.each(CONTRACT_TABLE)(
    '$code: accepts a custom message overriding the default',
    ({ ErrorClass }) => {
      const custom = 'a caller-supplied, client-safe message';
      const error = new ErrorClass(custom);
      expect(error.message).toBe(custom);
    },
  );

  it.each(CONTRACT_TABLE)(
    '$code: has a non-empty default message when constructed with no arguments',
    ({ ErrorClass }) => {
      const error = new ErrorClass();
      expect(typeof error.message).toBe('string');
      expect(error.message.length).toBeGreaterThan(0);
    },
  );
});
