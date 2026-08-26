import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Response } from 'superagent';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import {
  ANA_ID,
  BETO_ID,
  BOOKABLE_COURT_ID,
  resetAndSeed,
  truncateReservationTables,
} from './helpers/db';

/**
 * T016 — BR-01 under concurrency (SC-002).
 *
 * Real Postgres, real PrismaService (constitution §III): a mocked Prisma
 * client cannot exhibit a race condition, so this must run against the
 * actual `Reservation_no_overlap_per_court` exclusion constraint described
 * in specs/001-court-reservations/data-model.md.
 */
describe('Reservations (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors src/main.ts's bootstrap exactly: Test.createTestingModule does
    // not pick up main.ts, so the global pipe/filter must be wired here too.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    // Bind a real socket before any request fires. Without this, supertest's
    // own serverAddress() lazily calls app.listen(0) on the FIRST concurrent
    // request and then closes that socket once that single request
    // completes — which tears down the connection for the other 49 in-flight
    // requests before they can respond. That would produce false failures
    // (connection resets) with nothing to do with BR-01 itself.
    await app.listen(0);

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await truncateReservationTables(prisma);
    await app.close();
  });

  describe('POST /reservations', () => {
    it('BR-01: under 50 simultaneous requests for the identical court and slot, exactly one succeeds and 49 are refused as conflicts (SC-002)', async () => {
      await resetAndSeed(prisma);

      const CONCURRENT_REQUESTS = 50;
      // 2026-09-01 is a Tuesday, within the seeded court's Mon-Sat
      // 08:00-22:00 window, and in the future relative to "today"
      // (2026-08-26) — mirrors quickstart.md's manual walkthrough exactly.
      const payload = {
        courtId: BOOKABLE_COURT_ID,
        startTime: '2026-09-01T18:00:00.000-05:00',
        endTime: '2026-09-01T19:30:00.000-05:00',
      };

      const settled = await Promise.allSettled(
        Array.from({ length: CONCURRENT_REQUESTS }, () =>
          request(app.getHttpServer())
            .post('/reservations')
            .set('X-Customer-Id', ANA_ID)
            .send(payload),
        ),
      );

      // Every one of the 50 requests must resolve to an HTTP response —
      // none may reject the promise (e.g. a connection error), otherwise
      // the assertions below would be vacuous.
      const fulfilled = settled.filter(
        (result): result is PromiseFulfilledResult<Response> =>
          result.status === 'fulfilled',
      );
      expect(fulfilled).toHaveLength(CONCURRENT_REQUESTS);

      const responses = fulfilled.map((result) => result.value);
      const created = responses.filter((res) => res.status === 201);
      const conflicts = responses.filter((res) => res.status === 409);

      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(49);

      // Every refusal must be traceable to BR-01, per the documented error
      // envelope in contracts/reservations-api.md.
      conflicts.forEach((res) => {
        expect(res.body).toMatchObject({
          statusCode: 409,
          code: 'RESERVATION_OVERLAP',
          rule: 'BR-01',
        });
      });

      // The database, not just the HTTP layer, must agree: exactly one
      // active (non-cancelled) row for this court+slot.
      const activeReservations = await prisma.reservation.findMany({
        where: {
          courtId: BOOKABLE_COURT_ID,
          status: { not: 'CANCELLED' },
        },
      });
      expect(activeReservations).toHaveLength(1);
      expect(activeReservations[0]).toMatchObject({
        courtId: BOOKABLE_COURT_ID,
        startTime: new Date(payload.startTime),
        endTime: new Date(payload.endTime),
      });
    }, 30000);

    /**
     * T017 — BR-01 boundary (Story 1 acceptance scenarios 2-3; data-model.md's
     * `'[)'` exclusion-constraint bounds) plus FR-019 (new reservations are
     * created CONFIRMED). Runs against the real Postgres exclusion constraint,
     * not a mock, for the same reason T016 does.
     */
    it("BR-01: back-to-back bookings on the same court both succeed ('[)' bounds mean touching is not overlapping), but a slot overlapping their shared boundary is refused; FR-019: each created reservation is returned CONFIRMED", async () => {
      await resetAndSeed(prisma);

      // 2026-09-01 is a Tuesday, within the seeded court's Mon-Sat
      // 08:00-22:00 window, and in the future relative to "today"
      // (2026-08-26).
      const firstSlot = {
        courtId: BOOKABLE_COURT_ID,
        startTime: '2026-09-01T18:00:00.000-05:00',
        endTime: '2026-09-01T19:30:00.000-05:00',
      };
      const firstRes = await request(app.getHttpServer())
        .post('/reservations')
        .set('X-Customer-Id', ANA_ID)
        .send(firstSlot);

      expect(firstRes.status).toBe(201);
      expect(firstRes.body).toMatchObject({
        courtId: BOOKABLE_COURT_ID,
        status: 'CONFIRMED',
      });

      // Starts exactly when the first ends. The exclusion constraint's '[)'
      // bounds mean this touching slot is NOT an overlap, so it must succeed
      // (spec.md Story 1 scenario 3).
      const secondSlot = {
        courtId: BOOKABLE_COURT_ID,
        startTime: '2026-09-01T19:30:00.000-05:00',
        endTime: '2026-09-01T21:00:00.000-05:00',
      };
      const secondRes = await request(app.getHttpServer())
        .post('/reservations')
        .set('X-Customer-Id', BETO_ID)
        .send(secondSlot);

      expect(secondRes.status).toBe(201);
      expect(secondRes.body).toMatchObject({
        courtId: BOOKABLE_COURT_ID,
        status: 'CONFIRMED',
      });

      // Straddles the shared 19:30 boundary from both sides — a genuine
      // overlap against the first reservation (and the second) — so it must
      // be refused (spec.md Story 1 scenario 2).
      const overlappingSlot = {
        courtId: BOOKABLE_COURT_ID,
        startTime: '2026-09-01T19:00:00.000-05:00',
        endTime: '2026-09-01T20:00:00.000-05:00',
      };
      const overlapRes = await request(app.getHttpServer())
        .post('/reservations')
        .set('X-Customer-Id', ANA_ID)
        .send(overlappingSlot);

      expect(overlapRes.status).toBe(409);
      expect(overlapRes.body).toMatchObject({
        statusCode: 409,
        code: 'RESERVATION_OVERLAP',
        rule: 'BR-01',
      });

      // The database must agree: exactly the two touching reservations are
      // active, the rejected middle slot left no trace (FR-009).
      const activeReservations = await prisma.reservation.findMany({
        where: {
          courtId: BOOKABLE_COURT_ID,
          status: { not: 'CANCELLED' },
        },
        orderBy: { startTime: 'asc' },
      });
      expect(activeReservations).toHaveLength(2);
      expect(activeReservations[0]).toMatchObject({
        startTime: new Date(firstSlot.startTime),
        endTime: new Date(firstSlot.endTime),
      });
      expect(activeReservations[1]).toMatchObject({
        startTime: new Date(secondSlot.startTime),
        endTime: new Date(secondSlot.endTime),
      });
    });
  });
});
