import { z } from 'zod';

/**
 * Env is validated once, at boot. A missing secret should crash the process
 * immediately, not surface as a confusing 401 an hour into a live game.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET is too short'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET is too short'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  /** Public URL of the frontend — password reset links are built from it. */
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Optional in development: with no host, MailService logs messages instead.
  // MailService itself refuses to start in production without one.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Feyi <no-reply@feyi.local>'),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  isProduction: boolean;
};

export function loadConfiguration(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    // Dev defaults are committed to the repo, so shipping one to production
    // would mean anyone could mint a valid token.
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].includes('dev-only')) {
        throw new Error(`${key} is still the development placeholder`);
      }
    }
  }

  return {
    ...env,
    corsOrigins: env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
  };
}
