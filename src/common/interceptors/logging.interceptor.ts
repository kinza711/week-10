import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const { method, originalUrl } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          this.logger.log(`${method} ${originalUrl} ${res.statusCode} ${duration}ms`);
        },
        error: (err) => {
          const duration = Date.now() - start;
          const status = err.status ?? 500;
          this.logger.log(`${method} ${originalUrl} ${status} ${duration}ms`);
        },
      }),
    );
  }
}