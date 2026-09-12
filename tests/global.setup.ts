import { test as setup, expect } from '@playwright/test';
import { pingRedis } from '../src/redis/index.js';
import { createLogger } from '../src/core/logger.js';
import { env } from '../src/core/env.js';

/**
 * Global setup — runs once before any test project.
 * Treats Redis as optional so API-only suites still run without it.
 */
setup('prepare test environment', async ({ request }) => {
  const log = createLogger('global-setup');
  log.info(`environment: ${env.name} | target: ${env.baseUrl}`);

  // 1. Verify the target is reachable (non-fatal, placeholder hosts may be offline).
  try {
    const response = await request.get(env.baseUrl, { timeout: 10_000 });
    log.info(`target reachable (status ${response.status()})`);
  } catch (error) {
    log.warn(`target not reachable — UI specs will fail until BASE_URL is set: ${String(error)}`);
  }

  // 2. Skip Redis entirely when no token is configured.
  if (!env.redis.token) {
    log.warn('REDIS_TOKEN is not set — skipping Redis health check and flush');
    return;
  }

  // 3. Optionally flush stale test data, then check Upstash connectivity.
  if (env.redis.flushOnStart) {
    const { RedisHelper } = await import('../src/redis/index.js');
    try {
      await RedisHelper.clearAll();
    } catch (error) {
      log.warn(`could not flush Redis: ${String(error)}`);
    }
  }

  const redisUp = await pingRedis();
  expect(typeof redisUp).toBe('boolean');
  if (redisUp) log.info('redis health check passed');
  else log.warn('redis unavailable — specs using the redis fixture will fail');
});
