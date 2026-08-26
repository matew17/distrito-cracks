import { CourtsService } from './courts.service';
import { CourtsRepository } from './courts.repository';

/**
 * Unit spec for T022 (specs/001-court-reservations/tasks.md), covering:
 *
 * - BR-07 (docs/business-rules.md, spec.md FR-006): "A field under
 *   maintenance accepts no bookings." A court withdrawn from the catalogue
 *   (`isActive = false`) is refused for its own, distinct reason (spec.md:
 *   "Court withdrawn from the catalogue: refuses reservations for its own
 *   stated reason, separately from maintenance"). An active,
 *   not-under-maintenance court is bookable.
 * - BR-03 (spec.md FR-004): "Booking must fall within the field's operating
 *   hours." A weekday with a configured `CourtOperatingHour` row returns that
 *   window; a weekday with no configured row means the court is closed that
 *   day (data-model.md: "A missing row means the court is closed that
 *   weekday").
 *
 * Deliberately a unit test against a mocked `CourtsRepository`: neither rule
 * involves overlap, concurrency or capacity (constitution §III only mandates
 * real Postgres for those), and both methods operate on already-resolved
 * plain data (a `Court` entity, an array of `CourtOperatingHour` rows) rather
 * than performing their own DB access.
 *
 * Fixture/argument types are pulled from the service's own declared method
 * signatures (`Parameters<...>`) rather than hand-guessed, so this spec fails
 * to compile -- rather than silently drifting -- if the shape of
 * `checkBookability`/`getOperatingWindowForDay` ever changes. Only the
 * *business* assertions (bookable/not-bookable, distinct reasons, window vs.
 * closed) come from spec.md and docs/business-rules.md -- this spec does not
 * assert on any particular wording or code the implementation happens to
 * choose for the "distinct reason", since neither document mandates one.
 */

type BookabilityInput = Parameters<CourtsService['checkBookability']>[0];
type WindowLookupHours = Parameters<
  CourtsService['getOperatingWindowForDay']
>[0];
type WindowLookupDay = Parameters<CourtsService['getOperatingWindowForDay']>[1];

describe('CourtsService', () => {
  let service: CourtsService;
  let repository: CourtsRepository;

  beforeEach(() => {
    // Neither method under test performs its own repository/DB access, so
    // an empty mock is sufficient.
    repository = {} as unknown as CourtsRepository;
    service = new CourtsService(repository);
  });

  describe('checkBookability (BR-07)', () => {
    const activeNotMaintenanceCourt = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Cancha 1',
      isActive: true,
      underMaintenance: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as BookabilityInput;

    it('BR-07: a court with underMaintenance = true is not bookable', () => {
      const maintenanceCourt = {
        ...activeNotMaintenanceCourt,
        underMaintenance: true,
      } as BookabilityInput;

      const result = service.checkBookability(maintenanceCourt);

      expect(result.bookable).toBe(false);
    });

    it('BR-07: a court with isActive = false is not bookable, for its own distinct reason', () => {
      const maintenanceCourt = {
        ...activeNotMaintenanceCourt,
        underMaintenance: true,
      } as BookabilityInput;
      const withdrawnCourt = {
        ...activeNotMaintenanceCourt,
        isActive: false,
      } as BookabilityInput;

      const maintenanceResult = service.checkBookability(maintenanceCourt);
      const withdrawnResult = service.checkBookability(withdrawnCourt);

      expect(withdrawnResult.bookable).toBe(false);
      // "For its own distinct reason": the two non-bookable outcomes must be
      // distinguishable from one another, not collapsed into one generic
      // rejection.
      expect(withdrawnResult).not.toEqual(maintenanceResult);
    });

    it('BR-07: a court that is active and not under maintenance is bookable', () => {
      const result = service.checkBookability(activeNotMaintenanceCourt);

      expect(result.bookable).toBe(true);
    });
  });

  describe('getOperatingWindowForDay (BR-03)', () => {
    const TUESDAY = 2 as WindowLookupDay;
    const SUNDAY = 0 as WindowLookupDay;

    function hoursFixture(
      rows: Array<{ dayOfWeek: number; opensAt: number; closesAt: number }>,
    ): WindowLookupHours {
      return rows.map((row, index) => ({
        id: `oh-${index}`,
        courtId: '22222222-2222-2222-2222-222222222222',
        dayOfWeek: row.dayOfWeek,
        opensAt: row.opensAt,
        closesAt: row.closesAt,
      }));
    }

    it("BR-03: a configured day returns that weekday's window", () => {
      const hours = hoursFixture([
        { dayOfWeek: 2, opensAt: 480, closesAt: 1320 }, // Tuesday 08:00-22:00
      ]);

      const window = service.getOperatingWindowForDay(hours, TUESDAY);

      expect(window).not.toBeNull();
      expect(window).toMatchObject({ opensAt: 480, closesAt: 1320 });
    });

    it('BR-03: a day with no configured row is reported as closed (null)', () => {
      const hours = hoursFixture([
        { dayOfWeek: 2, opensAt: 480, closesAt: 1320 }, // Tuesday only
      ]);

      const window = service.getOperatingWindowForDay(hours, SUNDAY);

      expect(window).toBeNull();
    });

    it('BR-03: a court with no operating hours configured at all is closed every day', () => {
      const hours = hoursFixture([]);

      const window = service.getOperatingWindowForDay(hours, TUESDAY);

      expect(window).toBeNull();
    });
  });
});
