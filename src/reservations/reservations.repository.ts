import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  Reservation,
  ReservationStatus,
} from '../generated/prisma/client';
import { ReservationOverlapError } from '../common/domain/domain.exception';
import { ReservationWithCourt } from './dto/reservation.response';

/** Postgres SQLSTATE for an exclusion-constraint violation (research.md R2). */
const EXCLUSION_VIOLATION_SQLSTATE = '23P01';

/** Input shape for `ReservationsRepository.create()`. `customerId` and
 *  `status` are always supplied by the caller (the service) — never taken
 *  from the raw HTTP payload (research.md R5, data-model.md). */
export interface CreateReservationInput {
  courtId: string;
  customerId: string;
  startTime: Date;
  endTime: Date;
}

@Injectable()
export class ReservationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * BR-01 pre-check (research.md R1). Finds every non-cancelled reservation
   * on `courtId` whose `[startTime, endTime)` range overlaps the requested
   * `[start, end)` range — matching the `'[)'` bounds and the `WHERE status
   * <> 'CANCELLED'` predicate of the `Reservation_no_overlap_per_court`
   * exclusion constraint (data-model.md), so this pre-check and the
   * constraint agree on what counts as an overlap.
   *
   * This exists only to give the caller a fast, specific refusal in the
   * common case — it is an **optimisation, not the source of truth**. Two
   * concurrent requests can both pass this query and then race each other
   * into `create()`, which is exactly what the exclusion constraint (and its
   * translation below) guards against.
   */
  findOverlapping(
    courtId: string,
    start: Date,
    end: Date,
  ): Promise<Reservation[]> {
    return this.prisma.reservation.findMany({
      where: {
        courtId,
        status: { not: ReservationStatus.CANCELLED },
        startTime: { lt: end },
        endTime: { gt: start },
      },
    });
  }

  /**
   * Inserts a reservation as `CONFIRMED` (data-model.md: reservations
   * created through this feature are always confirmed) and returns it with
   * its `court` relation loaded, so the response mapper
   * (dto/reservation.response.ts) can read `courtName` without a second
   * query.
   *
   * If this insert loses a race that `findOverlapping` missed, Postgres
   * refuses it with the `23P01` exclusion-violation SQLSTATE from
   * `Reservation_no_overlap_per_court` — the constraint, not this pre-check,
   * is BR-01's actual guarantee (research.md R1). That failure is translated
   * here into `ReservationOverlapError` so no Prisma/SQL text reaches the
   * client (constitution §IV).
   *
   * Detection is deliberately defensive (research.md R2): Prisma has no
   * dedicated mapped error code for exclusion violations (unlike `P2002` for
   * unique violations), and with the `@prisma/adapter-pg` driver adapter
   * this codebase uses (see prisma/prisma.service.ts), the failure may
   * surface either as a `PrismaClientKnownRequestError` carrying the
   * SQLSTATE in its `code`/`meta`/`message`, or as the raw `pg` driver error
   * further down the error chain, which carries `code === '23P01'` directly.
   * Both paths are checked so neither shape silently turns a 409 into an
   * unhandled 500. The exact shape is confirmed empirically by the
   * integration test in test/reservations.e2e-spec.ts (T018), per
   * research.md's VERIFY note — this is defense-in-depth, not a guess.
   *
   * Any other, unexpected error is rethrown untranslated and falls through
   * to the global filter's generic-500 catch-all
   * (src/common/filters/domain-exception.filter.ts).
   */
  async create(input: CreateReservationInput): Promise<ReservationWithCourt> {
    try {
      return await this.prisma.reservation.create({
        data: {
          courtId: input.courtId,
          customerId: input.customerId,
          startTime: input.startTime,
          endTime: input.endTime,
          status: ReservationStatus.CONFIRMED,
        },
        include: { court: { select: { name: true } } },
      });
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new ReservationOverlapError();
      }
      throw error;
    }
  }
}

/**
 * True when `error` represents Postgres SQLSTATE `23P01` (exclusion
 * constraint violation), read from every place research.md R2 says it can
 * appear.
 */
function isExclusionViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === EXCLUSION_VIOLATION_SQLSTATE) {
      return true;
    }
    if (
      JSON.stringify(error.meta ?? {}).includes(EXCLUSION_VIOLATION_SQLSTATE)
    ) {
      return true;
    }
    return error.message.includes(EXCLUSION_VIOLATION_SQLSTATE);
  }

  return hasExclusionViolationCode(error);
}

/**
 * Walks `error` and its `.cause` chain looking for the raw `pg` driver error
 * shape that `@prisma/adapter-pg` surfaces when Prisma has no dedicated
 * mapped error code for the failure (research.md R2) — such an error carries
 * the SQLSTATE directly on `code`.
 */
function hasExclusionViolationCode(error: unknown, depth = 0): boolean {
  if (depth > 5 || error === null || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  if (candidate.code === EXCLUSION_VIOLATION_SQLSTATE) {
    return true;
  }
  if (
    typeof candidate.message === 'string' &&
    candidate.message.includes(EXCLUSION_VIOLATION_SQLSTATE)
  ) {
    return true;
  }
  if (candidate.cause !== undefined && candidate.cause !== error) {
    return hasExclusionViolationCode(candidate.cause, depth + 1);
  }
  return false;
}
