import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Problem W1, inverted by Challenge X2. This guard is now registered
 * globally (APP_GUARD in AuthModule) rather than applied per-controller
 * - a newly added route requires a token by default, and only the
 * handful marked @Public() (register, login, refresh) answer without
 * one. It still only answers "who are you" (401) - RolesGuard, which
 * must run after this one, is what decides "may you do this" (403).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
