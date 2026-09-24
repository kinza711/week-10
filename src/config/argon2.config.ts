import * as argon2 from 'argon2';

/**
 * Challenge X3. argon2 is slow on purpose, which is correct in production
 * and painful in a suite that hashes a password on every single test.
 * Cost parameters are read from the environment, with strong values as
 * the default and a deliberately weak override only in NODE_ENV=test.
 *
 * Production values (defaults, override via .env if ever needed):
 *   ARGON2_MEMORY_COST=19456 (19 MiB)  ARGON2_TIME_COST=2  ARGON2_PARALLELISM=1
 * Test values (used automatically when NODE_ENV=test):
 *   memoryCost=1024  timeCost=2  parallelism=1
 */
export function getArgon2Options(): argon2.Options & { raw?: false } {
  if (process.env.NODE_ENV === 'test') {
    return {
      type: argon2.argon2id,
      memoryCost: 1024, // argon2's hard minimum - still far below the prod default
      timeCost: 2, // argon2's hard minimum
      parallelism: 1,
    };
  }

  return {
    type: argon2.argon2id,
    memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
  };
}
