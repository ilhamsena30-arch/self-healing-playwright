import { closeRedis } from '../src/redis/index.js';
import { flushHealReport } from '../src/utils/reportWriter.js';
import { healingCache } from '../src/utils/healingCache.js';
import { createLogger } from '../src/core/logger.js';

/**
 * Global teardown — runs once after all projects finish.
 * Flushes the report queue, then closes the healing Redis client, each guarded
 * so one failure cannot skip the other (D16).
 */
export default async function globalTeardown(): Promise<void> {
  const log = createLogger('global-teardown');

  try {
    await flushHealReport();
    log.info('self-healing report flushed');
  } catch (error) {
    log.warn(`report flush issue: ${String(error)}`);
  }

  try {
    await healingCache.close();
    log.info('self-healing redis client closed');
  } catch (error) {
    log.warn(`healing cache close issue: ${String(error)}`);
  }

  try {
    closeRedis();
    log.info('resources released');
  } catch (error) {
    log.warn(`teardown issue: ${String(error)}`);
  }
}
