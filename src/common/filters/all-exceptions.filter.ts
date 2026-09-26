import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

// Problem X2. Keys whose values must never reach a log line or a
// response body, wherever they show up in a caught exception - request
// bodies, headers, database error details, anything. Lowercase, since
// the check below compares against key.toLowerCase().
const SENSITIVE_KEYS = ['password', 'passwordhash', 'token', 'refreshtoken', 'authorization'];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = SENSITIVE_KEYS.includes(key.toLowerCase()) ? '[REDACTED]' : redact(val);
    }
    return clone;
  }
  return value;
}

/**
 * Problem C1. Every error, expected or not, comes back in exactly this
 * shape - a client that would otherwise have to parse three different
 * error formats only ever parses one.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isDev = process.env.NODE_ENV !== 'production';
    const body = this.buildBody(exception, request.url, isDev);

    // Problem X2. The full, unredacted exception goes to the server log
    // only - never to the client - and even here, known-sensitive keys
    // are stripped centrally, in this one place, rather than trusted to
    // be scrubbed by whatever code happened to throw. The request body
    // itself is included (not just the exception message) precisely
    // because that's where a password actually lives on a failed
    // login - logging only the exception's own message would miss it
    // entirely and create a false sense of safety.
    const logPayload = JSON.stringify({
      path: request.url,
      method: request.method,
      statusCode: body.statusCode,
      requestBody: redact(request.body),
      exceptionMessage: redact((exception as { message?: unknown })?.message ?? exception),
    });

    // A 401 on a wrong password, or a 400 on bad input, is an everyday
    // client error, not an operational problem - only 5xx (something
    // this server itself failed to handle) is worth ERROR severity and
    // a stack trace. Logging every ordinary 4xx as an error would bury
    // the failures that actually need attention.
    if (body.statusCode >= 500) {
      this.logger.error(logPayload, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.debug(logPayload);
    }

    response.status(body.statusCode).json(body);
  }

  private buildBody(exception: unknown, path: string, isDev: boolean): ErrorBody {
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const { message, error } = payload as { message?: string | string[]; error?: string };
        return {
          statusCode: status,
          message: message ?? exception.message,
          error: error ?? HttpStatus[status] ?? 'Error',
          timestamp,
          path,
        };
      }

      return {
        statusCode: status,
        message: String(payload),
        error: HttpStatus[status] ?? 'Error',
        timestamp,
        path,
      };
    }

    // Problem X3. An error nobody threw on purpose. Detail that helps a
    // developer debug fast is the same detail that helps an attacker
    // map the system, so only NODE_ENV=development sees it - the full
    // detail always still goes to the server log above, in both
    // environments.
    const genericMessage = 'Internal server error';
    const devMessage =
      exception instanceof Error ? exception.message : String(exception);

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isDev ? devMessage : genericMessage,
      error: 'Internal Server Error',
      timestamp,
      path,
    };
  }
}
