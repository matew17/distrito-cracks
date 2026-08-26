import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { Customer } from '../../generated/prisma/client';
import { UnauthenticatedError } from '../domain/domain.exception';

const CUSTOMER_ID_HEADER = 'x-customer-id';

/**
 * Request augmented by `CurrentCustomerGuard` with the resolved requester.
 */
export interface RequestWithCustomer extends Request {
  customer: Customer;
}

/**
 * Resolves the requester's identity from the `X-Customer-Id` header.
 *
 * research.md R5: this repo has no authentication module, and building one is
 * a separate feature. This guard is a deliberate, thin, clearly labelled seam
 * standing in for real auth — it is NOT a security control. A header is
 * trivially spoofable by any caller, so it must never be relied on outside a
 * trusted/internal environment and must be replaced by real token
 * verification before this service is exposed publicly.
 *
 * `customerId` is resolved exclusively from this header. It must never be
 * read from a request body or route parameter — BR-08 ("only the owner may
 * cancel") is meaningless if the caller can simply assert a different id.
 */
@Injectable()
export class CurrentCustomerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithCustomer>();

    const customerId = request.headers[CUSTOMER_ID_HEADER];
    if (!customerId || typeof customerId !== 'string') {
      throw new UnauthenticatedError('X-Customer-Id header is required');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new UnauthenticatedError('Unknown customer');
    }

    request.customer = customer;
    return true;
  }
}
