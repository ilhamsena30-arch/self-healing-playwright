import { pingRedis } from '../src/redis/index.js';
import { healingCache } from '../src/utils/healingCache.js';
import { createLogger } from '../src/core/logger.js';
import { env } from '../src/core/env.js';

/**
 * Global setup — runs once before any test project (wired via `globalSetup` in
 * playwright.config.ts, which expects a default-export async function).
 * Treats Redis as optional so API-only suites still run without it.
 */
export default async function globalSetup(): Promise<void> {
  const log = createLogger('global-setup');
  log.info(`environment: ${env.name} | target: ${env.baseUrl}`);

  // 1. Verify the target is reachable (non-fatal, placeholder hosts may be offline).
  try {
    const response = await fetch(env.baseUrl, { signal: AbortSignal.timeout(10_000) });
    log.info(`target reachable (status ${response.status})`);
  } catch (error) {
    log.warn(`target not reachable — UI specs will fail until BASE_URL is set: ${String(error)}`);
  }

  // 2. Clear the self-healing cache ONCE, before any worker starts (D3). Never
  //    per-test: with fullyParallel and multiple workers a per-test clear would
  //    delete another worker's fresh heal mid-run. Guarded so a Redis outage
  //    cannot fail setup.
  try {
    await healingCache.clearAll();
  } catch (error) {
    log.warn(`healing cache clear failed (continuing): ${String(error)}`);
  }

  // 3. Skip Redis entirely when no token is configured.
  if (!env.redis.token) {
    log.warn('REDIS_TOKEN is not set — skipping Redis health check and flush');
    return;
  }

  // 4. Optionally flush stale test data, then check Upstash connectivity.
  if (env.redis.flushOnStart) {
    const { RedisHelper } = await import('../src/redis/index.js');
    try {
      await RedisHelper.clearAll();
    } catch (error) {
      log.warn(`could not flush Redis: ${String(error)}`);
    }
  }

  const redisUp = await pingRedis();
  if (redisUp) log.info('redis health check passed');
  else log.warn('redis unavailable — specs using the redis fixture will fail');
}
