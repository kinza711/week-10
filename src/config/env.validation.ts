import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().required(),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().required(),

  ARGON2_MEMORY_COST: Joi.number().required(),
  ARGON2_TIME_COST: Joi.number().required(),
  ARGON2_PARALLELISM: Joi.number().required(),

  CORS_ORIGIN: Joi.string().required(),
  AUTH_THROTTLE_LIMIT: Joi.number().required(),
});