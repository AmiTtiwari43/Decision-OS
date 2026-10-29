import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MONGODB_URI: z
    .string()
    .trim()
    .refine(
      val => val.startsWith('mongodb://') || val.startsWith('mongodb+srv://'),
      { message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://' }
    )
    .default('mongodb://127.0.0.1:27017/decision_os'),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters long')
    .default('development_jwt_secret_must_be_at_least_32_characters_long!'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(rawEnv: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map(err => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errorDetails}`);
  }
  return result.data;
}

export const env = validateEnv();
