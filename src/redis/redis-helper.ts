import { getRedisClient } from './client.js';
import { env } from '../core/env.js';
import { createLogger } from '../core/logger.js';
import type { RedisNamespace } from '../core/constants.js';

const log = createLogger('redis:helper');

export interface SetOptions {
  /** Expiry in seconds. */
  ttl?: number;
  /** Store as a JSON string (auto-detected: objects/arrays are serialised). */
  json?: boolean;
}

/**
 * Thin, namespaced facade over the Upstash Redis client.
 *
 * Every key is automatically prefixed with `<REDIS_KEY_PREFIX>:<namespace>:`
 * so that test data is easy to find, flush, and never collides with app data.
 *
 *   const redis = new RedisHelper('session');
 *   await redis.set('user:42', { token: 'abc' }, { ttl: 300 });
 *   const session = await redis.get<{ token: string }>('user:42');
 *
 * Upstash auto-deserialises JSON, so `get` returns objects directly when
 * `automaticDeserialization` is enabled on the client (it is).
 */
export class RedisHelper {
  private readonly namespace: string;

  constructor(namespace: RedisNamespace | string) {
    this.namespace = namespace;
  }

  /** Builds the fully-qualified Redis key. */
  key(...parts: (string | number)[]): string {
    return [env.redis.prefix, this.namespace, ...parts].join(':');
  }

  /** Creates a helper for a different namespace using the same connection. */
  forNamespace(namespace: RedisNamespace | string): RedisHelper {
    return new RedisHelper(namespace);
  }

  // ---------------------------------------------------------------------------
  // String operations
  // ---------------------------------------------------------------------------

  /** Set a value. Objects and arrays are serialised to JSON automatically. */
  async set<T>(key: string, value: T, options: SetOptions = {}): Promise<void> {
    const client = getRedisClient();
    const isObject = typeof value === 'object' && value !== null;
    const json = options.json ?? isObject;
    const payload = json ? JSON.stringify(value) : String(value);
    const fullKey = this.key(key);

    if (options.ttl) {
      await client.set(fullKey, payload, { ex: options.ttl });
    } else {
      await client.set(fullKey, payload);
    }
    log.debug(`SET ${fullKey} (ttl=${options.ttl ?? '-'})`);
  }

  /** Get a value. Returns `null` when the key does not exist. */
  async get<T>(key: string, options: { json?: boolean } = {}): Promise<T | null> {
    const client = getRedisClient();
    const payload = await client.get<T>(this.key(key));
    if (payload === null || payload === undefined) return null;

    // Upstash auto-deserialises; only parse manually when explicitly asked to.
    if (options.json === false) return payload;
    if (typeof payload !== 'string') return payload;

    try {
      return JSON.parse(payload) as T;
    } catch {
      return payload as unknown as T;
    }
  }

  /** Get a value or throw if missing (useful when the flow requires seeded data). */
  async getOrThrow<T>(key: string, options: { json?: boolean } = {}): Promise<T> {
    const value = await this.get<T>(key, options);
    if (value === null) {
      throw new Error(`Expected Redis key "${this.key(key)}" to exist, but it was missing.`);
    }
    return value;
  }

  async exists(key: string): Promise<boolean> {
    const client = getRedisClient();
    return (await client.exists(this.key(key))) === 1;
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const client = getRedisClient();
    const removed = await client.del(...keys.map((k) => this.key(k)));
    log.debug(`DEL ${removed} key(s) in "${this.namespace}"`);
    return removed;
  }

  /** Increment a counter, optionally setting expiry on first write. */
  async incr(key: string, options: { ttl?: number } = {}): Promise<number> {
    const client = getRedisClient();
    const fullKey = this.key(key);
    const value = await client.incr(fullKey);
    if (value === 1 && options.ttl) await client.expire(fullKey, options.ttl);
    return value;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const client = getRedisClient();
    await client.expire(this.key(key), ttlSeconds);
  }

  /** Remaining TTL in seconds. `-1` means no expiry, `-2` means missing. */
  async ttl(key: string): Promise<number> {
    const client = getRedisClient();
    return client.ttl(this.key(key));
  }

  // ---------------------------------------------------------------------------
  // Hash operations
  // ---------------------------------------------------------------------------

  async hSet(key: string, fields: Record<string, string | number>): Promise<void> {
    const client = getRedisClient();
    await client.hset(this.key(key), fields);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const client = getRedisClient();
    return (await client.hgetall<Record<string, string>>(this.key(key))) ?? {};
  }

  async hGet(key: string, field: string): Promise<string | null> {
    const client = getRedisClient();
    return client.hget<string>(this.key(key), field);
  }

  // ---------------------------------------------------------------------------
  // List operations
  // ---------------------------------------------------------------------------

  async push(key: string, ...values: string[]): Promise<number> {
    const client = getRedisClient();
    return client.rpush(this.key(key), ...values);
  }

  async list(key: string): Promise<string[]> {
    const client = getRedisClient();
    return (await client.lrange<string>(this.key(key), 0, -1)) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Test lifecycle helpers
  // ---------------------------------------------------------------------------

  /**
   * Deletes every key belonging to this namespace.
   *
   * Uses `SCAN` (cursor-based, non-blocking) rather than `KEYS` so it stays
   * safe on shared Redis instances.
   */
  async clearNamespace(): Promise<number> {
    return RedisHelper.deleteByPattern(`${env.redis.prefix}:${this.namespace}:*`, this.namespace);
  }

  /** Deletes every key matching the global test prefix. Use with care. */
  static clearAll(): Promise<number> {
    return RedisHelper.deleteByPattern(`${env.redis.prefix}:*`, `${env.redis.prefix}:*`);
  }

  private static async deleteByPattern(pattern: string, label: string): Promise<number> {
    const client = getRedisClient();
    let cursor = 0;
    const batch: string[] = [];

    do {
      const [nextCursor, keys] = await client.scan(cursor, { match: pattern, count: 200 });
      cursor = Number(nextCursor);
      batch.push(...keys);
    } while (cursor !== 0);

    const removed = batch.length > 0 ? await client.del(...batch) : 0;
    log.info(`cleared ${removed} key(s) matching "${label}"`);
    return removed;
  }

  /** Ping the Upstash endpoint — handy for a global setup health check. */
  static async ping(): Promise<boolean> {
    try {
      const result = await getRedisClient().ping();
      return result === 'PONG';
    } catch (error) {
      log.error('redis ping failed', error);
      return false;
    }
  }
}

/** Shared helpers for the most common namespaces. */
export const sessionStore = new RedisHelper('session');
export const userStore = new RedisHelper('user');
export const otpStore = new RedisHelper('otp');
export const cartStore = new RedisHelper('cart');
export const featureFlags = new RedisHelper('feature');
