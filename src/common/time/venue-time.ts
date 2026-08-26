/**
 * Venue-local time helpers (research.md R4).
 *
 * Reservations are stored as absolute `TIMESTAMPTZ` instants. Business rules
 * such as BR-03 (operating hours) must be evaluated against the venue's own
 * local weekday and time-of-day, not the host process's wall clock.
 *
 * `VENUE_TIMEZONE` is read from the environment (documented in `.env.example`,
 * defaulting to `America/Bogota`) and passed explicitly to `Intl.DateTimeFormat`
 * as the `timeZone` option. Because the zone is explicit, the result never
 * depends on the host process's `TZ` environment variable — the same instant
 * yields the same weekday and minutes-from-midnight regardless of where the
 * Node process happens to be running.
 */

const DEFAULT_VENUE_TIMEZONE = 'America/Bogota';

/** `0 = Sunday` — matches JavaScript's `Date.getDay()` and Postgres `EXTRACT(DOW)`. */
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getVenueTimeZone(): string {
  return process.env.VENUE_TIMEZONE ?? DEFAULT_VENUE_TIMEZONE;
}

/**
 * The venue-local weekday for the given instant, `0`(Sunday) through `6`(Saturday).
 */
export function getVenueWeekday(instant: Date): number {
  const timeZone = getVenueTimeZone();
  const weekdayToken = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(instant);

  const weekday = WEEKDAY_INDEX[weekdayToken];
  if (weekday === undefined) {
    throw new Error(
      `Unable to resolve venue-local weekday: unexpected token "${weekdayToken}" for timeZone "${timeZone}"`,
    );
  }

  return weekday;
}

/**
 * The venue-local minutes-from-midnight for the given instant, `0..1439`.
 *
 * Comparable against `CourtOperatingHour.opensAt` / `closesAt` (`0..1440`,
 * see data-model.md), which use the same minutes-from-midnight representation.
 */
export function getVenueMinutesFromMidnight(instant: Date): number {
  const timeZone = getVenueTimeZone();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const hourPart = parts.find((part) => part.type === 'hour');
  const minutePart = parts.find((part) => part.type === 'minute');
  if (!hourPart || !minutePart) {
    throw new Error(
      `Unable to resolve venue-local time: missing hour/minute parts for timeZone "${timeZone}"`,
    );
  }

  const hour = Number(hourPart.value);
  const minute = Number(minutePart.value);
  return hour * 60 + minute;
}
