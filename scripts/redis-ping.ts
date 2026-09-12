/**
 * Verifies Upstash connectivity and does a round-trip write/read.
 * Usage:  npm run redis:ping
 */
import { RedisHelper, getRedisClient, closeRedis } from '../src/redis/index.js';
import { env } from '../src/core/env.js';
import { createLogger } from '../src/core/logger.js';

const log = createLogger('redis-ping');

async function main(): Promise<void> {
  log.info(`url: ${env.redis.url}`);

  const pong = await getRedisClient().ping();
  log.info(`PING -> ${pong}`);

  const probe = new RedisHelper('healthcheck');
  await probe.set('roundtrip', { ok: true, at: Date.now() }, { ttl: 60 });
  const value = await probe.get<{ ok: boolean }>('roundtrip');
  log.info(`round-trip ${probe.key('roundtrip')} -> ${JSON.stringify(value)}`);

  await probe.del('roundtrip');
  log.info('round-trip key removed');

  closeRedis();
}

main().catch((error) => {
  log.error('ping failed', error);
  closeRedis();
  process.exitCode = 1;
});
