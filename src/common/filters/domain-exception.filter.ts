import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainException } from '../domain/domain.exception';

/**
 * Global exception filter (T009).
 *
 * Maps every `DomainException` (T008) to the documented error envelope
 * `{ statusCode, code, rule, message }` — see
 * specs/001-court-reservations/contracts/reservations-api.md, "Error
 * envelope". `rule` is omitted entirely (not sent as `null`) when the
 * exception carries none, e.g. `COURT_NOT_FOUND` or `UNAUTHENTICATED`.
 *
 * Everything else that is not a `DomainException` and not a raw Nest
 * `HttpException` is a true catch-all: the real error is logged
 * server-side (with stack, when available) and the client only ever
 * receives a generic `500` with no SQL, constraint/table names, SQLSTATE
 * or Prisma text of any kind (constitution §IV).
 *
 * One deliberate exception to "collapse everything to 500": a raw Nest
 * `HttpException` that is *not* a `DomainException`. In practice this is
 * `ValidationPipe`'s `BadRequestException` for a malformed DTO body. The
 * contract's evaluation order (contracts/reservations-api.md, "Evaluation
 * order", step 1 — "DTO shape → 400") requires that payload validation
 * failures surface as `400`, not `500`. `ValidationPipe` only ever echoes
 * back `class-validator` decorator messages — it never touches Prisma or
 * the database — so passing its status and body through unchanged cannot
 * leak persistence detail and does not violate §IV. Any other framework
 * `HttpException` thrown outside the domain layer is expected to be
 * similarly safe, so it is passed through the same way rather than
 * collapsed to a misleading `500`.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainException) {
      const status = exception.getStatus();
      const body: {
        statusCode: number;
        code: string;
        rule?: string;
        message: string;
      } = {
        statusCode: status,
        code: exception.code,
        message: exception.message,
      };
      if (exception.rule !== undefined) {
        body.rule = exception.rule;
      }
      response.status(status).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : exception,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
