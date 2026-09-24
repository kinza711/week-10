import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Challenge X2. Protected by default means a forgotten guard fails
 * closed; open by default means a forgotten guard fails open. This
 * marks the few routes - register, login, refresh - that are meant to
 * answer without a token, everything else requires one automatically.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
