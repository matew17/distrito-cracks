import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ANA_ID,
  ANA_NAME,
  ANA_PHONE,
  BETO_ID,
  BETO_NAME,
  BETO_PHONE,
  BOOKABLE_COURT_ID,
  BOOKABLE_COURT_NAME,
  resetAndSeed,
  seedBookableCourt,
  seedTwoCustomers,
  truncateReservationTables,
} from './helpers/db';

/**
 * Smoke check for the e2e harness itself (T015): proves the truncation and
 * seed helpers work against the real Postgres instance before any spec in
 * T016-T018/T029/T035-T036 relies on them. Not a BR-xx test.
 */
describe('e2e test harness (db helpers)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await truncateReservationTables(prisma);
    await app.close();
  });

  it('truncates and seeds a bookable court open Monday-Saturday with Sunday closed', async () => {
    await truncateReservationTables(prisma);

    const court = await seedBookableCourt(prisma);
    expect(court.id).toBe(BOOKABLE_COURT_ID);
    expect(court.name).toBe(BOOKABLE_COURT_NAME);
    expect(court.isActive).toBe(true);
    expect(court.underMaintenance).toBe(false);

    const hours = await prisma.courtOperatingHour.findMany({
      where: { courtId: BOOKABLE_COURT_ID },
      orderBy: { dayOfWeek: 'asc' },
    });
    expect(hours).toHaveLength(6);
    expect(hours.map((h) => h.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hours.every((h) => h.opensAt === 480 && h.closesAt === 1320)).toBe(
      true,
    );

    const sunday = await prisma.courtOperatingHour.findUnique({
      where: {
        courtId_dayOfWeek: { courtId: BOOKABLE_COURT_ID, dayOfWeek: 0 },
      },
    });
    expect(sunday).toBeNull();
  });

  it('seeds Ana and Beto with the exact fixture ids and phones', async () => {
    await truncateReservationTables(prisma);

    const { ana, beto } = await seedTwoCustomers(prisma);
    expect(ana.id).toBe(ANA_ID);
    expect(ana.name).toBe(ANA_NAME);
    expect(ana.phone).toBe(ANA_PHONE);
    expect(beto.id).toBe(BETO_ID);
    expect(beto.name).toBe(BETO_NAME);
    expect(beto.phone).toBe(BETO_PHONE);

    const count = await prisma.customer.count();
    expect(count).toBe(2);
  });

  it('truncates existing Reservation rows, not just Court/Customer/CourtOperatingHour', async () => {
    const { court, ana } = await resetAndSeed(prisma);

    await prisma.reservation.create({
      data: {
        courtId: court.id,
        customerId: ana.id,
        startTime: new Date('2026-09-01T18:00:00.000Z'),
        endTime: new Date('2026-09-01T19:30:00.000Z'),
      },
    });
    expect(await prisma.reservation.count()).toBe(1);

    await truncateReservationTables(prisma);

    expect(await prisma.reservation.count()).toBe(0);
    expect(await prisma.court.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.courtOperatingHour.count()).toBe(0);
  });

  it('resetAndSeed truncates prior state before re-seeding', async () => {
    await resetAndSeed(prisma);
    await resetAndSeed(prisma);

    const courtCount = await prisma.court.count();
    const customerCount = await prisma.customer.count();
    const hourCount = await prisma.courtOperatingHour.count();

    expect(courtCount).toBe(1);
    expect(customerCount).toBe(2);
    expect(hourCount).toBe(6);
  });
});
