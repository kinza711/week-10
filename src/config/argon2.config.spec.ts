import { getArgon2Options } from './argon2.config';

describe('getArgon2Options (Challenge X3)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalMemoryCost = process.env.ARGON2_MEMORY_COST;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ARGON2_MEMORY_COST = originalMemoryCost;
  });

  it('uses the strong, production-grade cost outside of NODE_ENV=test', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ARGON2_MEMORY_COST;

    const options = getArgon2Options();

    expect(options.memoryCost).toBe(19456);
    expect(options.timeCost).toBe(2);
  });

  it('uses a deliberately weak cost under NODE_ENV=test, so the suite stays fast', () => {
    process.env.NODE_ENV = 'test';

    const options = getArgon2Options();

    expect(options.memoryCost).toBe(1024);
    expect(options.timeCost).toBe(2);
    expect(options.memoryCost).toBeLessThan(19456); // strictly weaker than prod on the axis that matters
  });

  it('lets the production cost be raised via ARGON2_MEMORY_COST without a code change', () => {
    process.env.NODE_ENV = 'production';
    process.env.ARGON2_MEMORY_COST = '65536';

    expect(getArgon2Options().memoryCost).toBe(65536);
  });
});
