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

    /**
     * T018 — BR-01 error translation (research.md R2's VERIFY) and FR-009
     * across four distinct rejection paths.
     *
     * R2 flags that Prisma has no dedicated mapped error code for a Postgres
     * exclusion-violation (SQLSTATE `23P01`) the way it does for unique
     * violations (`P2002`); with the driver-adapter path the failure may
     * surface as a raw `pg` error wrapped in `PrismaClientUnknownRequestError`
     * instead. Whatever the internal shape, constitution §IV requires the
     * response body to be clean of that detail, so this test provokes the
     * real constraint violation over HTTP and inspects the actual JSON body
     * rather than assuming the detector's shape.
     */
    it('BR-01: a real exclusion-constraint violation is translated to the documented 409 envelope with no SQL, SQLSTATE, constraint or table name leaked', async () => {
      await resetAndSeed(prisma);

      // 2026-09-01 is a Tuesday, within the seeded court's Mon-Sat
      // 08:00-22:00 window, and in the future relative to "today"
      // (2026-08-26).
      const slot = {
        courtId: BOOKABLE_COURT_ID,
        startTime: '2026-09-01T18:00:00.000-05:00',
        endTime: '2026-09-01T19:30:00.000-05:00',
      };

      // Fired concurrently (not awaited one after another) for the identical
      // court+slot: a sequential pair would only ever exercise the service's
      // application-level pre-check, which always wins the race when there is
      // no actual race, so the real Postgres exclusion constraint (SQLSTATE
      // `23P01`) and the repository's catch/translate logic (research.md R2)
      // would never run. Firing them together forces at least one request
      // past the pre-check and into the real constraint violation. If the
      // 23P01-catching code in the repository were deleted, a sequential
      // version of this test would still pass unchanged — this version would
      // not (constitution §III).
      const CONCURRENT_REQUESTS = 5;
      const settled = await Promise.allSettled(
        Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
          request(app.getHttpServer())
            .post('/reservations')
            .set('X-Customer-Id', i % 2 === 0 ? ANA_ID : BETO_ID)
            .send(slot),
        ),
      );

      const fulfilled = settled.filter(
        (result): result is PromiseFulfilledResult<Response> =>
          result.status === 'fulfilled',
      );
      expect(fulfilled).toHaveLength(CONCURRENT_REQUESTS);

      const responses = fulfilled.map((result) => result.value);
      const created = responses.filter((res) => res.status === 201);
      const conflicts = responses.filter((res) => res.status === 409);

      // Exactly one request wins the slot; every other one — whether it lost
      // the application-level pre-check or the real DB exclusion constraint —
      // is refused as a conflict.
      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(CONCURRENT_REQUESTS - 1);

      // Take one of the 409s (win or lose the pre-check race, per R2 the
      // caller must see the same clean envelope either way) and assert on it.
      const secondRes = conflicts[0];
      expect(secondRes.status).toBe(409);
      expect(secondRes.body).toMatchObject({
        statusCode: 409,
        code: 'RESERVATION_OVERLAP',
        rule: 'BR-01',
      });
      const body = secondRes.body as { message: string };
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);

      // §IV: no leaked SQLSTATE, SQL text, constraint or table name anywhere
      // in the response body, whatever internal shape the driver produced.
      const serialisedBody = JSON.stringify(secondRes.body);
      expect(serialisedBody).not.toMatch(/23P01/i);
      expect(serialisedBody).not.toMatch(/Reservation_no_overlap_per_court/i);
      expect(serialisedBody).not.toMatch(/\bSELECT\b|\bINSERT\b|\bEXCLUDE\b/i);
      expect(serialisedBody).not.toMatch(/"Reservation"/); // quoted table name
      expect(serialisedBody).not.toMatch(/prisma/i);
      // The envelope has exactly the documented shape — no extra internal
      // fields (e.g. a raw `meta`/`clientVersion`) riding along.
      expect(Object.keys(secondRes.body as object).sort()).toEqual(
        ['code', 'message', 'rule', 'statusCode'].sort(),
      );

      // The database, not just the HTTP layer, must agree: exactly one
      // active row for this court+slot, no matter how many requests raced.
      const activeReservations = await prisma.reservation.findMany({
        where: {
          courtId: BOOKABLE_COURT_ID,
          status: { not: 'CANCELLED' },
        },
      });
      expect(activeReservations).toHaveLength(1);
    });

    /**
     * T018 — FR-009: none of the four rejection paths in scope for this
     * story leave a partial or placeholder row behind. Each case is checked
     * independently (row count immediately before vs. immediately after that
     * specific rejection), so this test stands on its own regardless of
     * T017's incidental overlap-path coverage.
     */
    it('FR-009: overlap, bad duration, outside-hours and maintenance rejections all leave the Reservation row count unchanged', async () => {
      await resetAndSeed(prisma);

      const countReservations = () => prisma.reservation.count();

      // --- Overlap (BR-01) ---------------------------------------------
      const baseSlot = {
        courtId: BOOKABLE_COURT_ID,
        startTime: '2026-09-01T18:00:00.000-05:00',
        endTime: '2026-09-01T19:30:00.000-05:00',
      };
      const createdRes = await request(app.getHttpServer())
        .post('/reservations')
        .set('X-Customer-Id', ANA_ID)
        .send(baseSlot);
      expect(createdRes.status).toBe(201);

      const countBeforeOverlap = await countReservations();
      const overlapRes = await request(app.getHttpServer())
        .post('/reservations')
        .set('X-Customer-Id', BETO_ID)
        .send(baseSlot);
      expect(overlapRes.status).toBe(409);
      expect(overlapRes.body).toMatchObject({ rule: 'BR-01' });
      expect(await countReservations()).toBe(countBeforeOverlap);

      // --- Bad duration (BR-02): 45 minutes, not a whole 30-min block and
      // below the 60-min minimum either way -----------------------------
      const countBeforeBadDuration = await countReservations();
      const badDurationRes = await request(app.getHttpServer())
        .post('/reservations')
        .set('X-Customer-Id', ANA_ID)
        .send({
          courtId: BOOKABLE_COURT_ID,
          startTime: '2026-09-02T10:00:00.000-05:00',
          endTime: '2026-09-02T10:45:00.000-05:00',
        });
      expect(badDurationRes.status).toBe(400);
      expect(badDurationRes.body).toMatchObject({
        code: 'INVALID_DURATION',
        rule: 'BR-02',
      });
      expect(await countReservations()).toBe(countBeforeBadDuration);

      // --- Outside operating hours (BR-03): court opens at 08:00, closes at
      // 22:00; a 22:30 start is after closing but stays on the same
      // venue-local calendar day (VENUE_TIMEZONE defaults to
      // America/Bogota, UTC-05:00, no DST — research.md R4), so this
      // exercises step 5 (OUTSIDE_OPERATING_HOURS, 409) rather than step 1's
      // SPANS_DAY_BOUNDARY (400), which a midnight-crossing slot would trip
      // first per contracts/reservations-api.md's fixed evaluation order. ---
      const countBeforeOutsideHours = await countReservations();
      const outsideHoursRes = await request(app.getHttpServer())
        .post('/reservations')
        .set('X-Customer-Id', ANA_ID)
        .send({
          courtId: BOOKABLE_COURT_ID,
          startTime: '2026-09-02T22:30:00.000-05:00',
          endTime: '2026-09-02T23:30:00.000-05:00',
        });
      expect(outsideHoursRes.status).toBe(409);
      expect(outsideHoursRes.body).toMatchObject({
        code: 'OUTSIDE_OPERATING_HOURS',
        rule: 'BR-03',
      });
      // Guards against a regression that would (wrongly) trip the day-span
      // check instead: both fall under BR-03, but only one is this
      // sub-case's target per the evaluation order.
      expect(outsideHoursRes.body).not.toMatchObject({
        code: 'SPANS_DAY_BOUNDARY',
      });
      expect(await countReservations()).toBe(countBeforeOutsideHours);

      // --- Maintenance (BR-07): a second court, under maintenance --------
      const MAINTENANCE_COURT_ID = '44444444-4444-4444-4444-444444444444';
      await prisma.court.create({
        data: {
          id: MAINTENANCE_COURT_ID,
          name: 'Cancha en mantenimiento',
          isActive: true,
          underMaintenance: true,
          operatingHours: {
            create: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
              dayOfWeek,
              opensAt: 480,
              closesAt: 1320,
            })),
          },
        },
      });

      const countBeforeMaintenance = await countReservations();
      const maintenanceRes = await request(app.getHttpServer())
        .post('/reservations')
        .set('X-Customer-Id', ANA_ID)
        .send({
          courtId: MAINTENANCE_COURT_ID,
          startTime: '2026-09-03T18:00:00.000-05:00',
          endTime: '2026-09-03T19:30:00.000-05:00',
        });
      expect(maintenanceRes.status).toBe(409);
      expect(maintenanceRes.body).toMatchObject({
        code: 'COURT_UNDER_MAINTENANCE',
        rule: 'BR-07',
      });
      expect(await countReservations()).toBe(countBeforeMaintenance);
    });
  });
});
