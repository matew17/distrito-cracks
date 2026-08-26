import { Reservation, ReservationStatus } from '../../generated/prisma/client';

/**
 * Documented shape of a reservation in every API response
 * (contracts/reservations-api.md: `POST /reservations`, `GET
 * /reservations/active`, `POST /reservations/:id/cancel`). Exactly these
 * seven fields — no more, no less.
 *
 * `customerId` is deliberately absent: contracts/reservations-api.md says
 * "customerId is not echoed — it is always the requester." `isRecurring` and
 * `isTraining` are Reservation columns (data-model.md) but are not part of
 * the documented response shape, so they are excluded too.
 */
export class ReservationResponseDto {
  id!: string;
  courtId!: string;
  courtName!: string;
  startTime!: string;
  endTime!: string;
  status!: ReservationStatus;
  price!: number;
}

/**
 * A `Reservation` row with its owning `Court` relation loaded, just enough
 * of it to resolve `courtName`. Deliberately narrower than the full Prisma
 * `Court` type so this mapper's input contract stays honest about what it
 * actually reads.
 */
export type ReservationWithCourt = Reservation & {
  court: { name: string };
};

/**
 * Maps a `Reservation` (joined with its `Court`) to the documented API
 * response shape. Built as an explicit field-by-field pick — never a spread
 * of `reservation` — so a future column added to the `Reservation` model
 * (e.g. another `customerId`-like field) cannot leak into a response by
 * accident.
 */
export function toReservationResponse(
  reservation: ReservationWithCourt,
): ReservationResponseDto {
  const dto = new ReservationResponseDto();
  dto.id = reservation.id;
  dto.courtId = reservation.courtId;
  dto.courtName = reservation.court.name;
  dto.startTime = reservation.startTime.toISOString();
  dto.endTime = reservation.endTime.toISOString();
  dto.status = reservation.status;
  dto.price = reservation.price;
  return dto;
}
