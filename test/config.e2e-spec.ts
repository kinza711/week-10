import { envValidationSchema } from '../src/config/env.validation';

describe('Config validation', () => {
  it('rejects a config object missing a required variable', () => {
    const invalidConfig = {
      NODE_ENV: 'test',
      PORT: 3000,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_NAME: 'test_db',
      // JWT_ACCESS_SECRET intentionally omitted
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      ARGON2_MEMORY_COST: 19456,
      ARGON2_TIME_COST: 2,
      ARGON2_PARALLELISM: 1,
      CORS_ORIGIN: 'http://localhost:3000',
      AUTH_THROTTLE_LIMIT: 5,
    };

    const { error } = envValidationSchema.validate(invalidConfig, {
      abortEarly: false,
    });

    expect(error).toBeDefined();
    expect(error?.message).toContain('JWT_ACCESS_SECRET');
  });

  it('rejects PORT with the wrong type', () => {
    const invalidConfig = {
      NODE_ENV: 'test',
      PORT: 'not-a-number',
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_NAME: 'test_db',
      JWT_ACCESS_SECRET: 'secret',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      ARGON2_MEMORY_COST: 19456,
      ARGON2_TIME_COST: 2,
      ARGON2_PARALLELISM: 1,
      CORS_ORIGIN: 'http://localhost:3000',
      AUTH_THROTTLE_LIMIT: 5,
    };

    const { error } = envValidationSchema.validate(invalidConfig, {
      abortEarly: false,
    });

    expect(error).toBeDefined();
  });

  it('accepts a fully valid config', () => {
    const validConfig = {
      NODE_ENV: 'test',
      PORT: 3000,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_NAME: 'test_db',
      JWT_ACCESS_SECRET: 'secret',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      ARGON2_MEMORY_COST: 19456,
      ARGON2_TIME_COST: 2,
      ARGON2_PARALLELISM: 1,
      CORS_ORIGIN: 'http://localhost:3000',
      AUTH_THROTTLE_LIMIT: 5,
    };

    const { error } = envValidationSchema.validate(validConfig, {
      abortEarly: false,
    });

    expect(error).toBeUndefined();
  });
});