import { getVenueMinutesFromMidnight, getVenueWeekday } from './venue-time';

/**
 * Unit spec for T011 (specs/001-court-reservations/tasks.md) covering
 * research.md R4: venue-local weekday/minute extraction must be driven by
 * the explicit `VENUE_TIMEZONE` configuration, never by the host process's
 * `TZ` or the instant's own UTC representation.
 *
 * Note on "closesAt = 1440": that value is a `CourtOperatingHour.closesAt`
 * field semantic (see data-model.md / research.md R3), meaning "open until
 * midnight". It is never a return value of `getVenueMinutesFromMidnight`,
 * which reads a real clock reading and is therefore bounded to `0..1439` by
 * construction. No test below asserts `1440` as a return value of that
 * function; the midnight-boundary coverage instead asserts that the instant
 * exactly at venue-local midnight yields `0` minutes on the *new* day.
 */
describe('venue-time', () => {
  const ORIGINAL_TZ = process.env.TZ;
  const ORIGINAL_VENUE_TIMEZONE = process.env.VENUE_TIMEZONE;

  afterEach(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
    if (ORIGINAL_VENUE_TIMEZONE === undefined) {
      delete process.env.VENUE_TIMEZONE;
    } else {
      process.env.VENUE_TIMEZONE = ORIGINAL_VENUE_TIMEZONE;
    }
  });

  beforeEach(() => {
    // Pin VENUE_TIMEZONE explicitly for every test in this file so results
    // are deterministic regardless of what the ambient environment (or a
    // loaded .env) happens to set.
    process.env.VENUE_TIMEZONE = 'America/Bogota';
  });

  describe('getVenueWeekday', () => {
    it('BR-03 support: returns the venue-local weekday, not the UTC weekday, when they differ', () => {
      // 2026-01-01T02:00:00Z is Thursday in UTC (getUTCDay() === 4), but
      // America/Bogota is UTC-5 with no DST, so venue-local time is
      // 2025-12-31T21:00:00-05:00 -- still Wednesday.
      const instant = new Date('2026-01-01T02:00:00.000Z');

      expect(instant.getUTCDay()).toBe(4); // Thursday in UTC (sanity check)
      expect(getVenueWeekday(instant)).toBe(3); // Wednesday, venue-local
    });

    it('BR-03 support: resolves a plain venue-local weekday correctly (Monday)', () => {
      // 2026-03-16T17:00:00Z is 12:00 venue-local, comfortably inside Monday
      // in both UTC and Bogota, so this is a plain sanity check.
      const instant = new Date('2026-03-16T17:00:00.000Z');
      expect(getVenueWeekday(instant)).toBe(1); // Monday
    });

    it('midnight boundary: an instant at venue-local midnight resolves to the NEW day', () => {
      // 2026-03-16T05:00:00Z is exactly 00:00:00 in America/Bogota (Monday).
      const monday00 = new Date('2026-03-16T05:00:00.000Z');
      expect(getVenueWeekday(monday00)).toBe(1); // Monday

      // 2026-03-17T04:59:00Z is 23:59 the day before (still Monday).
      const monday2359 = new Date('2026-03-17T04:59:00.000Z');
      expect(getVenueWeekday(monday2359)).toBe(1); // still Monday

      // 2026-03-17T05:00:00Z is exactly 00:00:00 the next day (Tuesday).
      const tuesday00 = new Date('2026-03-17T05:00:00.000Z');
      expect(getVenueWeekday(tuesday00)).toBe(2); // Tuesday, the new day
    });

    it('TZ-independence: result is unchanged when the process TZ changes, with VENUE_TIMEZONE fixed', () => {
      const instant = new Date('2026-01-01T02:00:00.000Z');

      process.env.TZ = 'UTC';
      const withUtcHostTz = getVenueWeekday(instant);

      process.env.TZ = 'America/New_York';
      const withNyHostTz = getVenueWeekday(instant);

      delete process.env.TZ;
      const withNoHostTz = getVenueWeekday(instant);

      expect(withUtcHostTz).toBe(3); // Wednesday, venue-local
      expect(withNyHostTz).toBe(3);
      expect(withNoHostTz).toBe(3);
    });
  });

  describe('getVenueMinutesFromMidnight', () => {
    it('resolves midnight venue-local time to 0', () => {
      const monday00 = new Date('2026-03-16T05:00:00.000Z'); // 00:00 Bogota
      expect(getVenueMinutesFromMidnight(monday00)).toBe(0);
    });

    it('resolves noon venue-local time to 720', () => {
      const noon = new Date('2026-03-16T17:00:00.000Z'); // 12:00 Bogota
      expect(getVenueMinutesFromMidnight(noon)).toBe(720);
    });

    it('resolves 23:59 venue-local time to 1439', () => {
      const almostMidnight = new Date('2026-03-17T04:59:00.000Z'); // 23:59 Bogota
      expect(getVenueMinutesFromMidnight(almostMidnight)).toBe(1439);
    });

    it('midnight boundary: rolls over to 0 exactly at the next venue-local midnight, never 1440', () => {
      const nextMidnight = new Date('2026-03-17T05:00:00.000Z'); // 00:00 Bogota, next day
      expect(getVenueMinutesFromMidnight(nextMidnight)).toBe(0);
      expect(getVenueMinutesFromMidnight(nextMidnight)).not.toBe(1440);
    });

    it('TZ-independence: result is unchanged when the process TZ changes, with VENUE_TIMEZONE fixed', () => {
      // 21:00 venue-local -> 21 * 60 = 1260 minutes from midnight.
      const instant = new Date('2026-01-01T02:00:00.000Z');

      process.env.TZ = 'UTC';
      const withUtcHostTz = getVenueMinutesFromMidnight(instant);

      process.env.TZ = 'America/New_York';
      const withNyHostTz = getVenueMinutesFromMidnight(instant);

      delete process.env.TZ;
      const withNoHostTz = getVenueMinutesFromMidnight(instant);

      expect(withUtcHostTz).toBe(1260);
      expect(withNyHostTz).toBe(1260);
      expect(withNoHostTz).toBe(1260);
    });

    it('TZ-independence: changing VENUE_TIMEZONE (not host TZ) does change the result', () => {
      // Same instant, but now the venue itself is configured in a different
      // zone. This is the control for the tests above: it proves the
      // function is sensitive to VENUE_TIMEZONE specifically, not inert.
      const instant = new Date('2026-01-01T02:00:00.000Z'); // 21:00 in Bogota (UTC-5)

      process.env.VENUE_TIMEZONE = 'America/Bogota';
      const bogotaMinutes = getVenueMinutesFromMidnight(instant);

      process.env.VENUE_TIMEZONE = 'UTC';
      const utcMinutes = getVenueMinutesFromMidnight(instant); // 02:00 UTC

      expect(bogotaMinutes).toBe(1260); // 21:00
      expect(utcMinutes).toBe(120); // 02:00
      expect(utcMinutes).not.toBe(bogotaMinutes);
    });
  });
});
