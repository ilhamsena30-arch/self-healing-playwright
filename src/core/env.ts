import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ path: process.env.ENV_FILE ?? '.env' });

/**
 * Declarative schema for every environment variable the framework consumes.
 * Add new variables here and they become type-safe everywhere via `env`.
 */
const envSchema = z.object({
  // --- Runner ---
  ENV: z.string().default('local'),
  CI: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  WORKERS: z.coerce.number().int().positive().default(2),
  RETRIES: z.coerce.number().int().min(0).default(1),
  TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  EXPECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  HEADLESS: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  SLOW_MO: z.coerce.number().int().min(0).default(0),
  VIDEO: z.enum(['off', 'on', 'retain-on-failure', 'on-first-retry']).default('retain-on-failure'),
  TRACE: z.enum(['off', 'on', 'retain-on-failure', 'on-first-retry']).default('retain-on-failure'),

  // --- Target under test (placeholders) ---
  BASE_URL: z.string().url().default('https://example.com'),
  API_BASE_URL: z.string().url().default('https://api.example.com'),

  // --- Credentials (placeholders) ---
  TEST_USERNAME: z.string().default('tester@example.com'),
  TEST_PASSWORD: z.string().default('SuperSecret123!'),
  TEST_TOKEN: z.string().default('placeholder-bearer-token'),

  // --- Redis (Upstash REST) ---
  REDIS_URL: z.string().default('https://fluent-worm-177361.upstash.io'),
  REDIS_TOKEN: z.string().default(''),
  REDIS_KEY_PREFIX: z.string().default('e2e'),
  REDIS_FLUSH_ON_START: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // --- Self-healing (Redis ioredis + LLM) ---
  // The self-healing Redis cache uses ioredis over a Redis URI (upstash://… or
  // redis://…). Defaults to the Upstash REST host + token so the same database
  // works for both the HTTP helper and the healing cache when no URI is set.
  HEALING_REDIS_URL: z.string().default(''),
  HEALING_REDIS_PASSWORD: z.string().default(''),
  // DeepSeek is OpenAI-API-compatible, so the `openai` SDK is reused against
  // DeepSeek's base URL. An empty key disables Tier 3/4 healing.
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  HEALING_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  HEALING_TIMEOUT_MS: z.coerce.number().int().positive().default(2_500),
  // `deepseek` uses the real LLM; `stub` returns a deterministic queued repair so
  // CI can exercise Tiers 2-4 with no network and no tokens.
  HEALING_PROVIDER: z.enum(['deepseek', 'stub']).default('deepseek'),
  HEALING_STUB_SELECTOR: z.string().default(''),
  HEALING_STUB_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.95),
  // Per-key expiry for the healing cache. 0 or -1 disables expiry (D3).
  HEALING_CACHE_TTL_SECONDS: z.coerce.number().int().default(604_800),

  // --- Reporting ---
  REPORT_OPEN: z.enum(['always', 'never', 'on-failure']).default('never'),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Fail fast: a misconfigured environment is worse than a crash.
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

/**
 * Normalised, typed environment object consumed by the framework.
 * Prefer this over reading `process.env` directly.
 */
export const env = {
  ...raw,
  isCI: raw.CI,
  name: raw.ENV,
  baseUrl: raw.BASE_URL.replace(/\/+$/, ''),
  apiBaseUrl: raw.API_BASE_URL.replace(/\/+$/, ''),
  username: raw.TEST_USERNAME,
  password: raw.TEST_PASSWORD,
  token: raw.TEST_TOKEN,
  workers: raw.WORKERS,
  retries: raw.RETRIES,
  timeoutMs: raw.TIMEOUT_MS,
  expectTimeoutMs: raw.EXPECT_TIMEOUT_MS,
  headless: raw.HEADLESS,
  slowMo: raw.SLOW_MO,
  video: raw.VIDEO,
  trace: raw.TRACE,
  reportOpen: raw.REPORT_OPEN,
  redis: {
    url: raw.REDIS_URL,
    token: raw.REDIS_TOKEN,
    prefix: raw.REDIS_KEY_PREFIX,
    flushOnStart: raw.REDIS_FLUSH_ON_START,
  },
  healing: {
    redisUrl: raw.HEALING_REDIS_URL,
    redisPassword: raw.HEALING_REDIS_PASSWORD,
    deepseekApiKey: raw.DEEPSEEK_API_KEY,
    deepseekModel: raw.DEEPSEEK_MODEL,
    deepseekBaseUrl: raw.DEEPSEEK_BASE_URL.replace(/\/+$/, ''),
    confidenceThreshold: raw.HEALING_CONFIDENCE_THRESHOLD,
    timeoutMs: raw.HEALING_TIMEOUT_MS,
    provider: raw.HEALING_PROVIDER,
    stubSelector: raw.HEALING_STUB_SELECTOR,
    stubConfidence: raw.HEALING_STUB_CONFIDENCE,
    cacheTtlSeconds: raw.HEALING_CACHE_TTL_SECONDS,
  },
} as const;

export type AppEnv = typeof env;
