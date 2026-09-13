import { Redis } from 'ioredis';
import { env } from '../core/env.js';
import { SELF_HEALING } from '../core/constants.js';
import { createLogger, type Logger } from '../core/logger.js';

/**
 * Singleton ioredis client for the self-healing locator cache.
 *
 * The rest of the suite talks to Upstash over its REST API (`@upstash/redis`),
 * but the healing tier is specified against raw Redis commands (`HSET`), so it
 * uses ioredis instead. Upstash exposes a RESP endpoint for every REST database
 * at `upstash://<url>:<token>@<url-host>:6379`, so the same database works for
 * both clients.
 *
 * Degradation rule: if the connection fails or is unconfigured, every accessor
 * returns `null` / `false` and the healing tier falls back to an in-memory map
 * plus the LLM — the test run must never crash because Redis is down.
 */
export interface HealingCache {
  get(failedSelector: string): Promise<string | null>;
  set(failedSelector: string, repairedSelector: string): Promise<void>;
  isConnected(): boolean;
  close(): Promise<void>;
}

const log: Logger = createLogger('healing:redis');

let instance: Redis | null = null;
let connectionError: Error | null = null;
let status: 'idle' | 'connecting' | 'ready' | 'failed' = 'idle';

/** Builds the Redis URI for ioredis, with a `redis://localhost:6379` fallback. */
function resolveUrl(): string {
  const configured = env.healing.redisUrl.trim();
  if (configured) return configured;

  // Fallback 1: Upstash REST URL + token -> RESP URI (same logical database).
  // Upstash exposes RESP at `<host>:6379` with username `default` and the REST
  // token as password, over TLS.
  if (env.redis.url && env.redis.token) {
    const host = env.redis.url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return `rediss://default:${encodeURIComponent(env.redis.token)}@${host}:6379`;
  }

  // Fallback 2: password from the healing config over a local instance.
  const password = env.healing.redisPassword.trim();
  if (password) return `redis://:${encodeURIComponent(password)}@localhost:6379`;

  return 'redis://localhost:6379';
}

/** Returns the shared client, or `null` when Redis cannot be used. */
export function getHealingRedis(): Redis | null {
  if (instance) return instance;
  if (status === 'failed') return null;

  status = 'connecting';
  try {
    instance = new Redis(resolveUrl(), {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
      connectTimeout: 3_000,
      enableReadyCheck: false,
      retryStrategy: () => null, // no silent infinite retries — fail fast, degrade
    });

    instance.on('ready', () => {
      status = 'ready';
      log.info('self-healing redis cache ready');
    });
    instance.on('error', (error) => {
      status = 'failed';
      connectionError = error;
      log.warn(`self-healing redis unavailable: ${error.message}`);
    });
    instance.on('end', () => {
      status = 'failed';
    });
  } catch (error) {
    status = 'failed';
    connectionError = error instanceof Error ? error : new Error(String(error));
    instance = null;
    log.warn(`self-healing redis failed to construct: ${connectionError.message}`);
  }

  return instance;
}

/** In-memory fallback used when Redis is down or unconfigured. */
const memoryCache = new Map<string, string>();

/**
 * Facade over the healing cache. Callers never need to know whether the backing
 * store is Redis or the in-memory map.
 */
export const healingCache: HealingCache = {
  async get(failedSelector: string): Promise<string | null> {
    if (memoryCache.has(failedSelector)) return memoryCache.get(failedSelector) ?? null;

    const client = getHealingRedis();
    if (!client) return null;
    try {
      const healed = await client.hget(SELF_HEALING.redisKey, failedSelector);
      return healed ?? null;
    } catch (error) {
      log.warn(`redis HGET failed, degrading to memory: ${String(error)}`);
      return null;
    }
  },

  async set(failedSelector: string, repairedSelector: string): Promise<void> {
    memoryCache.set(failedSelector, repairedSelector);

    const client = getHealingRedis();
    if (!client) return;
    try {
      await client.hset(SELF_HEALING.redisKey, failedSelector, repairedSelector);
    } catch (error) {
      log.warn(`redis HSET failed, keeping memory-only entry: ${String(error)}`);
    }
  },

  isConnected(): boolean {
    return status === 'ready';
  },

  async close(): Promise<void> {
    if (instance) {
      try {
        await instance.quit();
      } catch {
        instance.disconnect();
      }
      instance = null;
      status = 'idle';
      connectionError = null;
      log.debug('self-healing redis client released');
    }
  },
};
