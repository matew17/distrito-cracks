import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsService } from './reservations.service';
import { ReservationsRepository } from './reservations.repository';
import { CourtsService } from '../courts/courts.service';
import { CourtWithOperatingHours } from '../courts/courts.repository';
import {
  OutsideOperatingHoursError,
  CourtClosedThatDayError,
  SpansDayBoundaryError,
} from '../common/domain/domain.exception';
import { CourtOperatingHour } from '../generated/prisma/client';

/**
 * Unit spec for `ReservationsService`. Tasks.md serialises several task IDs
 * onto this one file (T020, T021, T028, T033, T034) — each owns one nested
 * `describe` block below the shared `ReservationsService` fixture, so later
 * appends only ever add a sibling `describe`, never touch this setup.
 *
 * `ReservationsRepository` and `CourtsService` are both mocked: neither BR-03
 * nor BR-06 (this file's other rules) involve overlap, concurrency or
 * capacity, so a real Postgres is not required here (constitution §III
 * reserves that for BR-01, covered in test/reservations.e2e-spec.ts). Wired
 * through `@nestjs/testing`'s `Test.createTestingModule` rather than a bare
 * `new ReservationsService(...)` so the test does not depend on constructor
 * *parameter order* — only on the two dependency *types* named across
 * data-model.md's "Rule-to-artifact map" and tasks.md T025/T026.
 *
 * ---
 *
 * ## T020 — BR-03 (docs/business-rules.md; spec.md FR-004; data-model.md's
 * `CourtOperatingHour`; contracts/reservations-api.md `OUTSIDE_OPERATING_HOURS`
 * / `COURT_CLOSED_THAT_DAY` / `SPANS_DAY_BOUNDARY`)
 *
 * "Booking must fall within the field's operating hours." A missing
 * `CourtOperatingHour` row for a weekday means the court is closed that day
 * (data-model.md). The close boundary is inclusive (spec.md Edge Cases: "the
 * end boundary is inclusive of the closing instant").
 *
 * All fixture dates sit in September 2026 — safely after the current instant
 * — so BR-06 ("not in the past", evaluated *before* BR-03 per
 * contracts/reservations-api.md's evaluation order) never interferes with
 * these assertions. 2026-09-01 is a venue-local Tuesday.
 *
 * **On `SPANS_DAY_BOUNDARY` and where it belongs.** The contract classifies
 * `SPANS_DAY_BOUNDARY` as a step-1 "DTO shape" `400`, contrasted with the
 * `409`s that need the court's configured hours. Taken alone that could read
 * as "this is a `class-validator` DTO concern, not `ReservationsService`'s."
 * But `SpansDayBoundaryError` lives in `common/domain/domain.exception.ts`,
 * whose own file-level doc comment says every class there is "raised by a
 * service", and it carries `rule: 'BR-03'` alongside
 * `OutsideOperatingHoursError` and `CourtClosedThatDayError` — not grouped
 * with a separate DTO-validation error type. Read together, the `400` is
 * about *what the check depends on* (the two given instants, not the court's
 * stored hours) rather than *which layer* raises it. This spec therefore
 * tests it here, at the service, as a defense-in-depth guard evaluated before
 * any single day's window is consulted. The scenario below is deliberately
 * constructed so that validating the start and end *independently* against
 * their own weekday's window would wrongly **pass** — proving the service
 * must reject a day-spanning slot outright, not merely re-derive it from two
 * per-instant checks. If T023's DTO implementation turns out to *also*
 * reject this at the payload level ahead of the service, that is consistent
 * with defense-in-depth, not a contradiction of this test.
 */
describe('ReservationsService', () => {
  let service: ReservationsService;
  let reservationsRepository: jest.Mocked<ReservationsRepository>;
  let courtsService: jest.Mocked<CourtsService>;

  // Named references to the individual mock functions, kept separate from
  // the `reservationsRepository`/`courtsService` objects that carry them.
  // Asserting against `object.method` directly (e.g.
  // `expect(reservationsRepository.findOverlapping).toHaveBeenCalled()`)
  // trips `@typescript-eslint/unbound-method`; asserting against the
  // standalone mock reference avoids that without weakening the assertion.
  let findOverlappingMock: jest.Mock;
  let createReservationMock: jest.Mock;
  let findByIdWithOperatingHoursMock: jest.Mock;
  let checkBookabilityMock: jest.Mock;
  let getOperatingWindowForDayMock: jest.Mock;

  const COURT_ID = '11111111-1111-4111-8111-111111111111';
  const CUSTOMER_ID = '99999999-9999-4999-8999-999999999999';

  function operatingHourRow(
    dayOfWeek: number,
    opensAt: number,
    closesAt: number,
  ): CourtOperatingHour {
    return {
      id: `oh-${dayOfWeek}`,
      courtId: COURT_ID,
      dayOfWeek,
      opensAt,
      closesAt,
    };
  }

  function bookableCourtWithHours(
    operatingHours: CourtOperatingHour[],
  ): CourtWithOperatingHours {
    return {
      id: COURT_ID,
      name: 'Cancha 1',
      isActive: true,
      underMaintenance: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      operatingHours,
    };
  }

  type CreateArgs = Parameters<ReservationsService['create']>;

  function createArgs(startTime: Date, endTime: Date): CreateArgs {
    return [{ courtId: COURT_ID, startTime, endTime }, CUSTOMER_ID];
  }

  beforeEach(async () => {
    findOverlappingMock = jest.fn();
    createReservationMock = jest.fn();
    findByIdWithOperatingHoursMock = jest.fn();
    checkBookabilityMock = jest.fn();
    getOperatingWindowForDayMock = jest.fn();

    reservationsRepository = {
      findOverlapping: findOverlappingMock,
      create: createReservationMock,
      findActiveByCustomer: jest.fn(),
      findByIdForOwner: jest.fn(),
      cancel: jest.fn(),
    };

    courtsService = {
      findByIdWithOperatingHours: findByIdWithOperatingHoursMock,
      checkBookability: checkBookabilityMock,
      getOperatingWindowForDay: getOperatingWindowForDayMock,
    } as unknown as jest.Mocked<CourtsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: ReservationsRepository, useValue: reservationsRepository },
        { provide: CourtsService, useValue: courtsService },
      ],
    }).compile();

    service = module.get(ReservationsService);
  });

  describe('BR-03 — operating hours', () => {
    beforeEach(() => {
      // Every scenario here is past BR-07 (bookable) and BR-06 (not past) —
      // those are covered by their own rules elsewhere in this file. A
      // bookable court is the default so failures observed below are
      // attributable to BR-03 alone.
      checkBookabilityMock.mockReturnValue({ bookable: true });
    });

    it('BR-03: rejects 21:00-23:00 against Tuesday hours of 08:00-22:00 (end after close)', async () => {
      const hours = [operatingHourRow(2, 480, 1320)]; // Tue 08:00 (480) - 22:00 (1320)
      findByIdWithOperatingHoursMock.mockResolvedValue(
        bookableCourtWithHours(hours),
      );
      getOperatingWindowForDayMock.mockReturnValue({
        opensAt: 480,
        closesAt: 1320,
      });

      const args = createArgs(
        new Date('2026-09-01T21:00:00.000-05:00'), // Tue 21:00
        new Date('2026-09-01T23:00:00.000-05:00'), // Tue 23:00 - after close
      );

      await expect(service.create(...args)).rejects.toThrow(
        OutsideOperatingHoursError,
      );
      expect(findOverlappingMock).not.toHaveBeenCalled();
      expect(createReservationMock).not.toHaveBeenCalled();
    });

    it('BR-03: rejects 06:00-07:30 against Tuesday hours of 08:00-22:00 (before open)', async () => {
      const hours = [operatingHourRow(2, 480, 1320)];
      findByIdWithOperatingHoursMock.mockResolvedValue(
        bookableCourtWithHours(hours),
      );
      getOperatingWindowForDayMock.mockReturnValue({
        opensAt: 480,
        closesAt: 1320,
      });

      const args = createArgs(
        new Date('2026-09-01T06:00:00.000-05:00'), // Tue 06:00 - before open
        new Date('2026-09-01T07:30:00.000-05:00'), // Tue 07:30 - before open
      );

      await expect(service.create(...args)).rejects.toThrow(
        OutsideOperatingHoursError,
      );
    });

    it('BR-03: rejects a weekday with no configured CourtOperatingHour row as closed', async () => {
      // Tuesday has hours; the request below targets Sunday, which has no
      // row at all — data-model.md: "a missing row means the court is closed
      // that weekday", represented as `null` from `getOperatingWindowForDay`.
      const hours = [operatingHourRow(2, 480, 1320)];
      findByIdWithOperatingHoursMock.mockResolvedValue(
        bookableCourtWithHours(hours),
      );
      getOperatingWindowForDayMock.mockReturnValue(null);

      const args = createArgs(
        new Date('2026-09-06T18:00:00.000-05:00'), // Sunday 18:00
        new Date('2026-09-06T19:30:00.000-05:00'), // Sunday 19:30
      );

      await expect(service.create(...args)).rejects.toThrow(
        CourtClosedThatDayError,
      );
    });

    it("BR-03: rejects a slot crossing a venue-local day boundary, even when each instant alone fits its own day's window", async () => {
      // Tuesday is open 08:00 until midnight (closesAt = 1440); the
      // following Wednesday is open from midnight until 22:00. The start
      // (Tue 23:00) is legal under Tuesday's window and the end (Wed 00:30)
      // is legal under Wednesday's window, taken separately — the request
      // must still be refused because it spans two venue-local days.
      const hours = [
        operatingHourRow(2, 480, 1440), // Tue 08:00 - midnight
        operatingHourRow(3, 0, 1320), // Wed midnight - 22:00
      ];
      findByIdWithOperatingHoursMock.mockResolvedValue(
        bookableCourtWithHours(hours),
      );
      getOperatingWindowForDayMock.mockImplementation((_hours, dayOfWeek) => {
        if (dayOfWeek === 2) return { opensAt: 480, closesAt: 1440 };
        if (dayOfWeek === 3) return { opensAt: 0, closesAt: 1320 };
        return null;
      });

      const args = createArgs(
        new Date('2026-09-01T23:00:00.000-05:00'), // Tue 23:00
        new Date('2026-09-02T00:30:00.000-05:00'), // Wed 00:30 - next day
      );

      await expect(service.create(...args)).rejects.toThrow(
        SpansDayBoundaryError,
      );
      expect(findOverlappingMock).not.toHaveBeenCalled();
      expect(createReservationMock).not.toHaveBeenCalled();
    });

    it('BR-03: accepts a slot ending exactly at closing time — the close boundary is inclusive', async () => {
      const hours = [operatingHourRow(2, 480, 1320)]; // Tue 08:00-22:00
      findByIdWithOperatingHoursMock.mockResolvedValue(
        bookableCourtWithHours(hours),
      );
      getOperatingWindowForDayMock.mockReturnValue({
        opensAt: 480,
        closesAt: 1320,
      });
      findOverlappingMock.mockResolvedValue([]);
      createReservationMock.mockResolvedValue({
        id: 'res-1',
        courtId: COURT_ID,
        court: { id: COURT_ID, name: 'Cancha 1' },
        customerId: CUSTOMER_ID,
        startTime: new Date('2026-09-01T20:30:00.000-05:00'),
        endTime: new Date('2026-09-01T22:00:00.000-05:00'),
        status: 'CONFIRMED',
        price: 140000,
        isRecurring: false,
        isTraining: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const args = createArgs(
        new Date('2026-09-01T20:30:00.000-05:00'), // Tue 20:30
        new Date('2026-09-01T22:00:00.000-05:00'), // Tue 22:00 - exactly at close
      );

      let caught: unknown;
      try {
        await service.create(...args);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeUndefined();
      expect(getOperatingWindowForDayMock).toHaveBeenCalled();
    });
  });
});
