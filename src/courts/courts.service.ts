import { Injectable } from '@nestjs/common';
import { CourtOperatingHour, Court } from '../generated/prisma/client';
import { CourtsRepository, CourtWithOperatingHours } from './courts.repository';

/**
 * Distinct reasons a court can fail the bookability check (BR-07). Each
 * false condition — withdrawn from the catalogue vs temporarily under
 * maintenance — must be distinguishable by the caller.
 */
export enum CourtUnbookableReason {
  NOT_ACTIVE = 'NOT_ACTIVE',
  UNDER_MAINTENANCE = 'UNDER_MAINTENANCE',
}

export type CourtBookability =
  { bookable: true } | { bookable: false; reason: CourtUnbookableReason };

/** A weekday's operating window, in minutes from midnight. */
export interface OperatingWindow {
  opensAt: number;
  closesAt: number;
}

/**
 * Query/predicate layer over `Court` and `CourtOperatingHour`. Deliberately
 * has no knowledge of HTTP exceptions — callers (e.g. `ReservationsService`)
 * interpret the plain data/booleans returned here and decide how to refuse a
 * request.
 */
@Injectable()
export class CourtsService {
  constructor(private readonly courtsRepository: CourtsRepository) {}

  /**
   * Finds a court by id including its operating hours, or `null` if no such
   * court exists.
   */
  findByIdWithOperatingHours(
    id: string,
  ): Promise<CourtWithOperatingHours | null> {
    return this.courtsRepository.findByIdWithOperatingHours(id);
  }

  /**
   * BR-07: a court is bookable only when `isActive === true` AND
   * `underMaintenance === false`. Each false condition carries its own
   * distinct reason so the caller can refuse with a specific message.
   */
  checkBookability(court: Court): CourtBookability {
    if (!court.isActive) {
      return { bookable: false, reason: CourtUnbookableReason.NOT_ACTIVE };
    }

    if (court.underMaintenance) {
      return {
        bookable: false,
        reason: CourtUnbookableReason.UNDER_MAINTENANCE,
      };
    }

    return { bookable: true };
  }

  /**
   * BR-03: looks up the operating window for a given venue-local weekday
   * (`0`-`6`, `0` = Sunday). A missing row for that weekday IS the closed-day
   * representation — this returns `null` in that case, never a distinct
   * "closed" flag.
   */
  getOperatingWindowForDay(
    operatingHours: CourtOperatingHour[],
    dayOfWeek: number,
  ): OperatingWindow | null {
    const window = operatingHours.find((hour) => hour.dayOfWeek === dayOfWeek);

    if (!window) {
      return null;
    }

    return { opensAt: window.opensAt, closesAt: window.closesAt };
  }
}
