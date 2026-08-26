import {
  IsISO8601,
  IsNotEmpty,
  IsUUID,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * ISO-8601 timestamps accepted by this DTO must carry an explicit UTC
 * offset ("Z" or "+HH:MM"/"-HH:MM") per contracts/reservations-api.md, so a
 * client cannot send an ambiguous local time.
 */
const HAS_EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

const MIN_DURATION_MS = 60 * 60_000; // 60 minutes
const MAX_DURATION_MS = 180 * 60_000; // 180 minutes
const DURATION_STEP_MS = 30 * 60_000; // 30-minute blocks

/**
 * BR-02 (docs/business-rules.md, spec.md FR-003, data-model.md's
 * `Reservation_duration_valid` CHECK): `endTime` must be strictly after
 * `startTime`, and the millisecond difference between the two must fall
 * within [60, 180] minutes in exact 30-minute increments.
 *
 * Compared at millisecond resolution (tasks.md A1) so a sub-second
 * discrepancy — e.g. 60 minutes plus 400ms — cannot pass as a whole
 * 30-minute block.
 *
 * There is no start-alignment rule here: BR-02 constrains duration only
 * (spec.md FR-003, tasks.md U1) — a 90-minute slot starting at 18:10 is
 * valid.
 */
@ValidatorConstraint({ name: 'isValidReservationDuration', async: false })
class IsValidReservationDurationConstraint implements ValidatorConstraintInterface {
  validate(endTime: unknown, args: ValidationArguments): boolean {
    const { startTime } = args.object as { startTime?: unknown };
    if (typeof startTime !== 'string' || typeof endTime !== 'string') {
      return false;
    }

    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return false;
    }

    const durationMs = endMs - startMs;

    return (
      durationMs > 0 &&
      durationMs >= MIN_DURATION_MS &&
      durationMs <= MAX_DURATION_MS &&
      durationMs % DURATION_STEP_MS === 0
    );
  }

  defaultMessage(): string {
    return 'endTime must be 60-180 minutes after startTime, in 30-minute blocks (BR-02)';
  }
}

export class CreateReservationDto {
  @IsUUID()
  @IsNotEmpty()
  courtId!: string;

  @IsISO8601({ strict: true })
  @Matches(HAS_EXPLICIT_OFFSET, {
    message:
      'startTime must be an ISO-8601 timestamp with an explicit UTC offset',
  })
  startTime!: string;

  @IsISO8601({ strict: true })
  @Matches(HAS_EXPLICIT_OFFSET, {
    message:
      'endTime must be an ISO-8601 timestamp with an explicit UTC offset',
  })
  @Validate(IsValidReservationDurationConstraint)
  endTime!: string;
}
