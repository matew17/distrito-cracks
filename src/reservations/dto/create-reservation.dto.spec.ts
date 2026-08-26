import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReservationDto } from './create-reservation.dto';

/**
 * BR-02 (docs/business-rules.md, spec.md FR-003, data-model.md's
 * `Reservation_duration_valid` CHECK, contracts/reservations-api.md
 * `INVALID_DURATION`):
 *
 *   "Duration: min 60 min, max 180 min, in 30 min blocks."
 *
 * BR-02 constrains *duration only* — there is no start-alignment rule
 * (spec.md FR-003, Story 1 scenario 5; U1 in tasks.md's Post-Analysis
 * Revisions explicitly removed a start-alignment check that had no
 * requirement behind it). Durations must be compared at millisecond
 * resolution, not seconds, so a sub-second discrepancy cannot pass as a
 * whole 30-minute block (tasks.md A1; data-model.md's raw SQL comment gives
 * the concrete counter-example: 3600.4s must not pass as 60 minutes).
 *
 * This exercises `CreateReservationDto` directly through `class-validator`'s
 * `validate()`, against instances built with `plainToInstance`, mirroring the
 * global `ValidationPipe({ transform: true })` registered in src/main.ts.
 * `courtId` is always a well-formed UUID and `startTime`/`endTime` are always
 * well-formed ISO-8601 strings with an explicit offset, so that any
 * validation errors observed are attributable to BR-02 (duration) and not to
 * some other field constraint.
 */
describe('CreateReservationDto — BR-02 duration validation', () => {
  const courtId = '11111111-1111-4111-8111-111111111111';
  const MINUTE_MS = 60_000;

  /** A future base instant so BR-06 (not tested here) never interferes. */
  const BASE_START = '2026-09-01T18:00:00.000-05:00';

  function payloadFor(startIso: string, endIso: string) {
    return {
      courtId,
      startTime: startIso,
      endTime: endIso,
    };
  }

  function payloadForDurationMs(durationMs: number, startIso = BASE_START) {
    const end = new Date(new Date(startIso).getTime() + durationMs);
    return payloadFor(startIso, end.toISOString());
  }

  async function errorsFor(payload: Record<string, unknown>) {
    const instance = plainToInstance(CreateReservationDto, payload);
    return validate(instance);
  }

  describe('rejects invalid durations', () => {
    it.each([
      ['45 minutes', 45 * MINUTE_MS],
      ['30 minutes', 30 * MINUTE_MS],
      ['75 minutes', 75 * MINUTE_MS],
      ['210 minutes', 210 * MINUTE_MS],
    ])('BR-02: rejects a %s duration', async (_label, durationMs) => {
      const errors = await errorsFor(payloadForDurationMs(durationMs));

      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('rejects inverted and zero-length ranges', () => {
    it('BR-02: rejects an inverted range where endTime is before startTime', async () => {
      const start = new Date(BASE_START);
      const invertedEnd = new Date(start.getTime() - 90 * MINUTE_MS);
      const errors = await errorsFor(
        payloadFor(start.toISOString(), invertedEnd.toISOString()),
      );

      expect(errors.length).toBeGreaterThan(0);
    });

    it('BR-02: rejects a zero-length range where endTime equals startTime', async () => {
      const errors = await errorsFor(payloadForDurationMs(0));

      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('accepts every legal duration', () => {
    it.each([
      ['60 minutes', 60 * MINUTE_MS],
      ['90 minutes', 90 * MINUTE_MS],
      ['120 minutes', 120 * MINUTE_MS],
      ['150 minutes', 150 * MINUTE_MS],
      ['180 minutes', 180 * MINUTE_MS],
    ])('BR-02: accepts a %s duration', async (_label, durationMs) => {
      const errors = await errorsFor(payloadForDurationMs(durationMs));

      expect(errors).toHaveLength(0);
    });
  });

  it('BR-02: accepts a 90-minute slot starting at 18:10 — duration only, no start alignment (FR-003)', async () => {
    const errors = await errorsFor(
      payloadForDurationMs(90 * MINUTE_MS, '2026-09-01T18:10:00.000-05:00'),
    );

    expect(errors).toHaveLength(0);
  });

  it('BR-02: rejects a duration that is 60 minutes plus 400ms — must compare in exact milliseconds, not rounded seconds/minutes', async () => {
    // 3,600,400 ms: one 30-minute block (actually one hour) plus a
    // sub-second remainder. Rounding to whole seconds (3600.4s -> "3600s")
    // or whole minutes would wrongly let this pass as exactly 60 minutes.
    const errors = await errorsFor(payloadForDurationMs(60 * MINUTE_MS + 400));

    expect(errors.length).toBeGreaterThan(0);
  });
});
