/**
 * Seeds Redis with the data the UI/API specs expect to already exist.
 *
 * Usage:  npm run seed
 */
import { RedisHelper, closeRedis } from '../src/redis/index.js';
import { buildItemPayload, users } from '../src/data/test-data.js';
import { createLogger } from '../src/core/logger.js';

const log = createLogger('seed');

async function main(): Promise<void> {
  const sessions = new RedisHelper('session');
  const carts = new RedisHelper('cart');
  const features = new RedisHelper('feature');

  log.info('seeding Upstash Redis with test data...');

  await sessions.set(
    'seed:user',
    { username: users.standard.username, seededAt: Date.now() },
    { ttl: 3_600 },
  );

  await carts.set('seed:item', buildItemPayload({ name: 'seeded-item' }), { ttl: 3_600 });

  await features.hSet('flags', { newDashboard: 'true', checkoutV2: 'false' });

  log.info(`seed complete (keys under "${sessions.key('seed:user')}")`);
  closeRedis();
}

main().catch((error) => {
  log.error('seed failed', error);
  closeRedis();
  process.exitCode = 1;
});
