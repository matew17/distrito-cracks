import { PrismaService } from '../../src/prisma/prisma.service';
import type { Court, Customer } from '../../src/generated/prisma/client';

/**
 * Fixture ids/values matching quickstart.md's "Seed a bookable court" section
 * verbatim, so e2e specs (T016-T018, T029, T035-T036) and the manual
 * walkthrough exercise the exact same data.
 */
export const BOOKABLE_COURT_ID = '11111111-1111-1111-1111-111111111111';
export const BOOKABLE_COURT_NAME = 'Cancha 1';

/** Minutes-from-midnight, per data-model.md's `CourtOperatingHour` shape. */
export const BOOKABLE_COURT_OPENS_AT = 480; // 08:00
export const BOOKABLE_COURT_CLOSES_AT = 1320; // 22:00

/** Monday(1)-Saturday(6). Sunday (0) is deliberately left unseeded = closed. */
const OPEN_WEEKDAYS = [1, 2, 3, 4, 5, 6] as const;

export const ANA_ID = '22222222-2222-2222-2222-222222222222';
export const ANA_NAME = 'Ana';
export const ANA_PHONE = '+573001112233';

export const BETO_ID = '33333333-3333-3333-3333-333333333333';
export const BETO_NAME = 'Beto';
export const BETO_PHONE = '+573004445566';

/**
 * Wipes every table this feature touches, in FK-safe order (children before
 * parents), against the real Postgres instance backing `prisma`. Intended to
 * run before each e2e test so BR-01's exclusion constraint is exercised
 * against real DB state, never a mocked client (constitution §III).
 */
export async function truncateReservationTables(
  prisma: PrismaService,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Reservation", "CourtOperatingHour", "Court", "Customer" CASCADE',
  );
}

/**
 * Seeds the "Cancha 1" bookable court from quickstart.md: active, not under
 * maintenance, open 08:00-22:00 Monday-Saturday, with Sunday left with no
 * `CourtOperatingHour` row at all — a missing row *is* the closed-day case.
 */
export async function seedBookableCourt(prisma: PrismaService): Promise<Court> {
  return prisma.court.create({
    data: {
      id: BOOKABLE_COURT_ID,
      name: BOOKABLE_COURT_NAME,
      isActive: true,
      underMaintenance: false,
      operatingHours: {
        create: OPEN_WEEKDAYS.map((dayOfWeek) => ({
          dayOfWeek,
          opensAt: BOOKABLE_COURT_OPENS_AT,
          closesAt: BOOKABLE_COURT_CLOSES_AT,
        })),
      },
    },
  });
}

/**
 * Seeds the two customers from quickstart.md ("Ana" and "Beto") with their
 * exact fixture ids and phone numbers.
 */
export async function seedTwoCustomers(
  prisma: PrismaService,
): Promise<{ ana: Customer; beto: Customer }> {
  const [ana, beto] = await Promise.all([
    prisma.customer.create({
      data: { id: ANA_ID, name: ANA_NAME, phone: ANA_PHONE },
    }),
    prisma.customer.create({
      data: { id: BETO_ID, name: BETO_NAME, phone: BETO_PHONE },
    }),
  ]);
  return { ana, beto };
}

/**
 * Convenience for the common per-test arrangement: start from a clean slate,
 * then seed the bookable court and both customers. Returns the seeded rows
 * so a test can reference generated fields without re-querying.
 */
export async function resetAndSeed(prisma: PrismaService): Promise<{
  court: Court;
  ana: Customer;
  beto: Customer;
}> {
  await truncateReservationTables(prisma);
  const [court, customers] = await Promise.all([
    seedBookableCourt(prisma),
    seedTwoCustomers(prisma),
  ]);
  return { court, ana: customers.ana, beto: customers.beto };
}
