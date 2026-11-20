import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const nonEmptyOrUndefined = (val: unknown) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.preprocess(nonEmptyOrUndefined, z.string().url().default('http://localhost:3000')),

  DATABASE_URL: z.preprocess(
    nonEmptyOrUndefined,
    z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/codemania?schema=public'),
  ),
  REDIS_URL: z.string().default(''),

  JWT_ACCESS_SECRET: z.preprocess(
    nonEmptyOrUndefined,
    z.string().min(16).default('dev-access-secret-change-in-production'),
  ),
  JWT_REFRESH_SECRET: z.preprocess(
    nonEmptyOrUndefined,
    z.string().min(16).default('dev-refresh-secret-change-in-production'),
  ),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  MAX_LEVELS_PER_DAY: z.coerce.number().positive().default(3),
  FINAL_EXAM_TIME_LIMIT_MINUTES: z.coerce.number().int().positive().default(45),
  FINAL_EXAM_QUESTION_COUNT: z.coerce.number().int().positive().default(20),
  ADMIN_EMAILS: z.string().default(''),

  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_ANSWER_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  RATE_LIMIT_ANSWER_MAX: z.coerce.number().int().positive().default(60),

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_SUCCESS_URL: z.preprocess(
    nonEmptyOrUndefined,
    z.string().default('http://localhost:3000/commitments/stripe/success'),
  ),
  STRIPE_CANCEL_URL: z.preprocess(
    nonEmptyOrUndefined,
    z.string().default('http://localhost:3000/commitments/stripe/cancel'),
  ),

  HF_ENDPOINT_URL: z.string().default(''),
  HF_TOKEN: z.string().default(''),
  TTS_DEFAULT_LANGUAGE: z.string().default('en'),
  TTS_DEFAULT_VOICE_ID: z.string().default('default'),
  AUDIO_PUBLIC_BASE_URL: z.preprocess(
    nonEmptyOrUndefined,
    z.string().default('http://localhost:3000/audio'),
  ),

  // Daily Quiz: "Aristotle"
  DAILY_TZ: z.string().default('UTC'),
  DAILY_QUESTION_SECONDS: z.coerce.number().int().positive().default(60),
  DAILY_BUFFER_DAYS: z.coerce.number().int().positive().default(7),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): EnvConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    let generated = false;
    if (parsed.data.JWT_ACCESS_SECRET.startsWith('dev-')) {
      parsed.data.JWT_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
      generated = true;
    }
    if (parsed.data.JWT_REFRESH_SECRET.startsWith('dev-')) {
      parsed.data.JWT_REFRESH_SECRET = crypto.randomBytes(48).toString('hex');
      generated = true;
    }
    if (generated) {
      console.warn(
        '[codemania] JWT_ACCESS_SECRET / JWT_REFRESH_SECRET not configured; generated ephemeral runtime secrets.',
      );
    }
  }
  if (
    process.env.NGINX_PORT &&
    String(parsed.data.PORT) === String(process.env.NGINX_PORT)
  ) {
    parsed.data.PORT = Number(process.env.DEFAULT_APP_PORT || 3000);
  }
  return parsed.data;
}

export const env: EnvConfig = loadEnv();

export function getAdminEmailSet(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
