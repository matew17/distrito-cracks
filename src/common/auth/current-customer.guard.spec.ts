import { ExecutionContext } from '@nestjs/common';
import { CurrentCustomerGuard } from './current-customer.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { UnauthenticatedError } from '../domain/domain.exception';

/**
 * Unit coverage for the identity seam described in research.md R5 and
 * contracts/reservations-api.md: every endpoint requires an `X-Customer-Id`
 * header, missing or unknown resolves to 401 `UNAUTHENTICATED`, and a known
 * id attaches the resolved `Customer` to the request for `@CurrentCustomer()`
 * to read.
 *
 * This is deliberately a unit test, not an e2e one: no controller exists yet
 * (T027/T032/T039 are unimplemented), so there is nothing to hit end-to-end.
 * The guard's contract is fully exercisable today against a mocked
 * `PrismaService` -- no real Postgres is needed to prove "missing header
 * throws", "unknown id throws" and "known id attaches and allows".
 */
describe('CurrentCustomerGuard', () => {
  const knownCustomer = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Ada Lovelace',
    phone: '3000000000',
    reservationCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let findCustomer: jest.Mock;
  let prisma: PrismaService;
  let guard: CurrentCustomerGuard;

  beforeEach(() => {
    findCustomer = jest.fn();
    // Cover both plausible Prisma lookup shapes (`findUnique` by id and
    // `findFirst`) so the test does not depend on which one the guard calls
    // -- only on the observable 401 / attach behaviour the spec documents.
    prisma = {
      customer: {
        findUnique: findCustomer,
        findFirst: findCustomer,
      },
    } as unknown as PrismaService;

    guard = new CurrentCustomerGuard(prisma);
  });

  function contextFor(headers: Record<string, string>) {
    const request: Record<string, unknown> = { headers };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getClass: () => undefined,
      getHandler: () => undefined,
    } as unknown as ExecutionContext;
    return { context, request };
  }

  it('throws 401 Unauthorized when the X-Customer-Id header is missing', async () => {
    const { context } = contextFor({});

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthenticatedError,
    );
    expect(findCustomer).not.toHaveBeenCalled();
  });

  it('throws 401 Unauthorized when the X-Customer-Id header names an unknown customer', async () => {
    findCustomer.mockResolvedValue(null);
    const { context } = contextFor({
      'x-customer-id': '99999999-9999-9999-9999-999999999999',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('resolves the customer and allows the request when the header names a known customer', async () => {
    findCustomer.mockResolvedValue(knownCustomer);
    const { context, request } = contextFor({
      'x-customer-id': knownCustomer.id,
    });

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    // The decorator's job (per research.md R5 / T012) is to hand this back
    // to controllers -- so the guard must have put it somewhere on the
    // request for `@CurrentCustomer()` to read.
    expect(request.customer).toEqual(knownCustomer);
  });

  it('never resolves identity from anything other than the header (no body/param fallback)', async () => {
    findCustomer.mockResolvedValue(knownCustomer);
    const request: Record<string, unknown> = {
      headers: {},
      body: { customerId: knownCustomer.id },
      params: { customerId: knownCustomer.id },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getClass: () => undefined,
      getHandler: () => undefined,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthenticatedError,
    );
  });
});
