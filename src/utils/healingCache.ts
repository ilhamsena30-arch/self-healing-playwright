import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { env } from '../core/env.js';
import { SELF_HEALING } from '../core/constants.js';
import { createLogger, type Logger } from '../core/logger.js';

/**
 * Per-key self-healing cache (D3).
 *
 * Replaces the old `healed_locators` hash with one Redis key per heal, because
 * Redis cannot expire individual hash fields. Each key carries a JSON payload and
 * its own TTL. Key shape:
 *
 *   {REDIS_KEY_PREFIX}:heal:{CACHE_VERSION}:{ENV}:{pathname}:{sha1(rawSelector)}
 *
 * The cache degrades to an in-memory Map when Redis is down or unconfigured; a
 * Redis outage must never crash a run. The old `healed_locators` hash is left
 * untouched (the new key shape never reads it).
 */

/** One persisted heal. Written only after the verification gate passes (D2). */
export interface HealEntry {
  repairedSelector: string;
  confidence: number;
  /** false when the repair had no parseable semantics to verify against (D4/D12). */
  verified: boolean;
  reasoning: string;
  healedAt: string;
  /** Original locator expression, e.g. the raw engine string. */
  originalDescribe: string;
  model: string;
  cacheVersion: number;
}

export interface HealingCache {
  get(pageUrl: string, failedSelector: string): Promise<HealEntry | null>;
  set(pageUrl: string, failedSelector: string, entry: HealEntry): Promise<void>;
  /** Clears every heal under this run's prefix. Called once from globalSetup. */
  clearAll(): Promise<void>;
  isConnected(): boolean;
  close(): Promise<void>;
}

const log: Logger = createLogger('healing:cache');

let instance: Redis | null = null;
let status: 'idle' | 'connecting' | 'ready' | 'failed' = 'idle';

/** Builds the Redis URI for ioredis, with a `redis://localhost:6379` fallback. */
function resolveUrl(): string {
  const configured = env.healing.redisUrl.trim();
  if (configured) return configured;

  // Fallback 1: Upstash REST URL + token -> RESP URI (same logical database).
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
function getRedis(): Redis | null {
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
    instance.on('error', () => {
      status = 'failed';
    });
    instance.on('end', () => {
      status = 'failed';
    });
  } catch (error) {
    status = 'failed';
    instance = null;
    log.warn(
      `self-healing redis failed to construct: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return instance;
}

/** In-memory fallback used when Redis is down or unconfigured. */
const memoryCache = new Map<string, HealEntry>();

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

/**
 * Extracts the `pathname` segment used in the cache key. Unparseable or
 * non-http(s) URLs (e.g. `about:blank`) fall back to `__unknown__` (D3).
 */
export function pathnameOf(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '__unknown__';
    return url.pathname;
  } catch {
    return '__unknown__';
  }
}

/**
 * Pure key builder, exported for unit tests. The run-time wrapper (`healingKey`)
 * injects the live env / constant values.
 */
export function buildHealingKey(
  prefix: string,
  cacheVersion: number,
  envName: string,
  pathname: string,
  selectorHash: string,
): string {
  return `${prefix}:heal:${cacheVersion}:${envName}:${pathname}:${selectorHash}`;
}

/** Builds the full cache key for a failed selector on a given page (D3). */
export function healingKey(pageUrl: string, failedSelector: string): string {
  return buildHealingKey(
    env.redis.prefix,
    SELF_HEALING.cacheVersion,
    env.name,
    pathnameOf(pageUrl),
    sha1(failedSelector),
  );
}

/** Writes a heal to Redis with its per-key TTL, or to the memory map only. */
async function persist(key: string, payload: string, ttlSeconds: number): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    if (ttlSeconds > 0) {
      await client.set(key, payload, 'EX', ttlSeconds);
    } else {
      await client.set(key, payload);
    }
  } catch (error) {
    log.warn(`redis SET failed, keeping memory-only entry: ${String(error)}`);
  }
}

/**
 * Facade over the healing cache. Callers never need to know whether the backing
 * store is Redis or the in-memory map.
 */
export const healingCache: HealingCache = {
  async get(pageUrl: string, failedSelector: string): Promise<HealEntry | null> {
    const key = healingKey(pageUrl, failedSelector);

    if (memoryCache.has(key)) return memoryCache.get(key) ?? null;

    const client = getRedis();
    if (!client) return null;
    try {
      const raw = await client.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as HealEntry;
      memoryCache.set(key, parsed);
      return parsed;
    } catch (error) {
      log.warn(`redis GET failed, treating as miss: ${String(error)}`);
      return null;
    }
  },

  async set(pageUrl: string, failedSelector: string, entry: HealEntry): Promise<void> {
    const key = healingKey(pageUrl, failedSelector);
    memoryCache.set(key, entry);
    await persist(key, JSON.stringify(entry), env.healing.cacheTtlSeconds);
  },

  async clearAll(): Promise<void> {
    memoryCache.clear();

    const client = getRedis();
    if (!client) return;
    const pattern = `${env.redis.prefix}:heal:*`;
    try {
      let cursor = '0';
      const batch: string[] = [];
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = nextCursor;
        batch.push(...keys);
      } while (cursor !== '0');
      if (batch.length > 0) await client.del(...batch);
      log.info(`cleared ${batch.length} heal key(s) matching "${pattern}"`);
    } catch (error) {
      log.warn(`healing cache clear failed (degrading to memory-only): ${String(error)}`);
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
      log.debug('self-healing redis client released');
    }
  },
};
