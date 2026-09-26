import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

const REDACTED_HEADER_KEYS = ['authorization', 'cookie', 'x-api-key'];
const REDACTED_BODY_KEYS = ['password', 'refreshToken', 'accessToken', 'token'];

function redact(source: Record<string, any> | undefined, keys: string[]) {
  if (!source || typeof source !== 'object') return source;
  const clone: Record<string, any> = { ...source };
  for (const key of keys) {
    if (clone[key] !== undefined) clone[key] = '[REDACTED]';
  }
  return clone;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const { method, originalUrl } = req;
    const start = Date.now();

    const safeHeaders = redact(req.headers, REDACTED_HEADER_KEYS);
    const safeBody = redact(req.body, REDACTED_BODY_KEYS);

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          this.logger.log(
            `${method} ${originalUrl} ${res.statusCode} ${duration}ms` +
              ` auth=${safeHeaders?.authorization ?? '-'}` +
              ` body=${JSON.stringify(safeBody ?? {})}`,
          );
        },
        error: (err) => {
          const duration = Date.now() - start;
          const status = err.status ?? 500;
          this.logger.log(
            `${method} ${originalUrl} ${status} ${duration}ms` +
              ` auth=${safeHeaders?.authorization ?? '-'}` +
              ` body=${JSON.stringify(safeBody ?? {})}`,
          );
        },
      }),
    );
  }
}