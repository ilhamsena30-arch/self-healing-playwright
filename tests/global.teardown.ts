import { closeRedis } from '../src/redis/index.js';
import { createLogger } from '../src/core/logger.js';

/**
 * Global teardown — runs once after all projects finish.
 * Upstash is stateless, so this only releases the client reference.
 */
export default async function globalTeardown(): Promise<void> {
  const log = createLogger('global-teardown');
  try {
    closeRedis();
    log.info('resources released');
  } catch (error) {
    log.warn(`teardown issue: ${String(error)}`);
  }
}
