import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { DomainExceptionFilter } from './domain-exception.filter';
import {
  ReservationOverlapError,
  CourtNotFoundError,
  UnauthenticatedError,
} from '../domain/domain.exception';

/**
 * Black-box coverage for T009 (`src/common/filters/domain-exception.filter.ts`),
 * derived purely from:
 *   - specs/001-court-reservations/contracts/reservations-api.md ("Error envelope")
 *   - .specify/memory/constitution.md §IV ("Never expose Prisma error messages
 *     to clients")
 *
 * The filter implementation itself was deliberately NOT read while writing
 * this spec. Every assertion below is derived from the contract's documented
 * envelope shape and the constitution's leak-prevention rule.
 */
type ResponseBody = Record<string, unknown>;

describe('DomainExceptionFilter', () => {
  let filter: DomainExceptionFilter;
  let jsonMock: jest.Mock<void, [ResponseBody]>;
  let statusMock: jest.Mock;
  let response: { status: jest.Mock; json: jest.Mock<void, [ResponseBody]> };
  let host: ArgumentsHost;

  function lastBody(): ResponseBody {
    const call = jsonMock.mock.calls[0];
    if (!call) {
      throw new Error('response.json was never called');
    }
    return call[0];
  }

  beforeEach(() => {
    filter = new DomainExceptionFilter();
    jsonMock = jest.fn<void, [ResponseBody]>();

    // "status() returning itself, chainable" per the harness convention used
    // for T012's guard spec.
    response = {
      status: jest.fn(),
      json: jsonMock,
    };
    statusMock = response.status;
    statusMock.mockImplementation(() => response);

    host = {
      switchToHttp: () => ({
        getRequest: () => ({ url: '/reservations', method: 'POST' }),
        getResponse: () => response,
      }),
      getArgByIndex: jest.fn(),
      getArgs: jest.fn(),
      getType: () => 'http',
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
    } as unknown as ArgumentsHost;
  });

  describe('domain exceptions with a rule (contract "Error envelope" example)', () => {
    it('BR-01: maps ReservationOverlapError to 409 with statusCode, code, rule and message', () => {
      const exception = new ReservationOverlapError();

      filter.catch(exception, host);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledTimes(1);
      const body = lastBody();

      expect(body).toEqual({
        statusCode: 409,
        code: 'RESERVATION_OVERLAP',
        rule: 'BR-01',
        message: 'That time slot is already booked on this court.',
      });
      // Exactly the four documented keys -- no more, no less.
      expect(Object.keys(body).sort()).toEqual(
        ['statusCode', 'code', 'rule', 'message'].sort(),
      );
    });
  });

  describe('domain exceptions without a rule', () => {
    it('maps CourtNotFoundError to 404 with no `rule` key present at all (not null)', () => {
      const exception = new CourtNotFoundError();

      filter.catch(exception, host);

      expect(statusMock).toHaveBeenCalledWith(404);
      const body = lastBody();

      expect(body).toMatchObject({
        statusCode: 404,
        code: 'COURT_NOT_FOUND',
        message: 'No court was found with the given id.',
      });
      expect('rule' in body).toBe(false);
    });

    it('maps UnauthenticatedError to 401 with no `rule` key present at all (not null)', () => {
      const exception = new UnauthenticatedError();

      filter.catch(exception, host);

      expect(statusMock).toHaveBeenCalledWith(401);
      const body = lastBody();

      expect(body).toMatchObject({
        statusCode: 401,
        code: 'UNAUTHENTICATED',
        message: 'Missing or unknown customer identity.',
      });
      expect('rule' in body).toBe(false);
    });
  });

  describe('§IV: non-domain errors never leak persistence detail', () => {
    it('maps a plain Error to a generic 500 with no rule and no trace of its message', () => {
      const marker = 'FAKE_CONSTRAINT_XYZ_violation';
      const exception = new Error(`boom: ${marker}`);

      filter.catch(exception, host);

      expect(statusMock).toHaveBeenCalledWith(500);
      const body = lastBody();
      const serialized = JSON.stringify(body);

      expect(serialized).not.toContain(marker);
      expect(body.statusCode).toBe(500);
      expect('rule' in body).toBe(false);
    });

    it('maps a fake Prisma-shaped constraint-violation error to a generic 500 with no SQL/constraint/table leakage', () => {
      const marker = 'FAKE_CONSTRAINT_XYZ_violation';
      // Mimics the shape of a PrismaClientKnownRequestError / pg driver error
      // carrying SQLSTATE, constraint and table names in its message.
      const fakePrismaError = Object.assign(
        new Error(
          `insert into "Reservation" ... violates exclusion constraint "Reservation_no_overlap_per_court" SQLSTATE 23P01 ${marker}`,
        ),
        {
          code: '23P01',
          meta: { table: 'Reservation', constraint: marker },
        },
      );

      filter.catch(fakePrismaError, host);

      expect(statusMock).toHaveBeenCalledWith(500);
      const body = lastBody();
      const serialized = JSON.stringify(body).toLowerCase();

      expect(serialized).not.toContain(marker.toLowerCase());
      expect(serialized).not.toContain('23p01');
      expect(serialized).not.toContain('sqlstate');
      expect(serialized).not.toContain('reservation_no_overlap_per_court');
      expect(serialized).not.toContain('exclusion constraint');
      expect('rule' in body).toBe(false);
    });
  });

  describe('a raw NestJS HttpException that is not a DomainException', () => {
    it('passes through with its own status and body rather than collapsing to 500 (contract: "DTO shape → 400")', () => {
      // The global ValidationPipe throws exactly this kind of exception for
      // a malformed payload. The contract's fixed evaluation order requires
      // step 1, "DTO shape → 400", to actually reach the client as a 400 --
      // if the filter's catch-all swallowed every non-domain HttpException
      // into a generic 500, that contractual guarantee could never be met.
      const exception = new BadRequestException('some validation message');

      filter.catch(exception, host);

      expect(statusMock).toHaveBeenCalledWith(400);
      const body = lastBody();
      expect(JSON.stringify(body)).toContain('some validation message');
    });
  });
});
