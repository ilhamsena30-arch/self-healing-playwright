import { Redis } from '@upstash/redis';
import { env } from '../core/env.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('redis');

/**
 * Upstash Redis client.
 *
 * Upstash is HTTP-based and stateless, so there is no connect/quit lifecycle:
 * a single instance is created lazily on first use and reused for the process.
 *
 * Credentials are read from the environment (`REDIS_URL` + `REDIS_TOKEN`).
 */
let client: Redis | null = null;

/** Creates (or returns the cached) Upstash Redis client. */
export function getRedisClient(): Redis {
  if (client) return client;

  if (!env.redis.url) {
    throw new Error('REDIS_URL is not set. Add your Upstash REST URL to the .env file.');
  }
  if (!env.redis.token) {
    throw new Error('REDIS_TOKEN is not set. Add your Upstash REST token to the .env file.');
  }

  client = new Redis({
    url: env.redis.url,
    token: env.redis.token,
    // Retry transient network/5xx failures instead of failing the spec immediately.
    retry: {
      retries: 3,
      backoff: (retryCount) => Math.min(retryCount * 100, 1_000),
    },
    automaticDeserialization: true,
  });

  log.info(`upstash redis ready (prefix="${env.redis.prefix}")`);
  return client;
}

/**
 * Upstash needs no teardown, so this simply drops the cached reference.
 * Kept so `global.teardown.ts` works unchanged.
 */
export function closeRedis(): void {
  client = null;
  log.debug('redis client reference released');
}

/** Low-level passthrough; prefer `RedisHelper` for namespaced access. */
export function rawClient(): Redis {
  return getRedisClient();
}

/** Health check against the Upstash REST endpoint. */
export async function pingRedis(): Promise<boolean> {
  try {
    const result = await getRedisClient().ping();
    return result === 'PONG';
  } catch (error) {
    log.error('redis ping failed', error);
    return false;
  }
}
