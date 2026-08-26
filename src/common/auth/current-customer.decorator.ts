import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Customer } from '../../generated/prisma/client';
import { RequestWithCustomer } from './current-customer.guard';

/**
 * Hands the `Customer` resolved by `CurrentCustomerGuard` to a controller
 * method. Must only be used on routes protected by that guard — see the
 * caveat there about `X-Customer-Id` being a spoofable placeholder, not real
 * authentication (research.md R5).
 */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Customer => {
    const request = ctx.switchToHttp().getRequest<RequestWithCustomer>();
    return request.customer;
  },
);
