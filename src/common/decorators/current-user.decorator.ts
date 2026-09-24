import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * Problem W2. Reads back the user JwtAuthGuard already validated and
 * attached to the request - it does no validation itself. A userId sent
 * in the request body is a claim from the client; this is the only
 * identity a route can actually trust.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
