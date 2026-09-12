import { test as base, expect } from '@playwright/test';
import { Screens } from '../screen/index.js';
import { ApiFactory } from '../api/index.js';
import { LoginFlow, ItemFlow } from '../flow/index.js';
import { RedisHelper } from '../redis/index.js';
import { createLogger, type Logger } from '../core/logger.js';

/**
 * Custom fixtures exposed to every spec.
 *
 * Specs should depend on `flows` (and optionally `api` / `redis`) rather than
 * constructing screens themselves. Adding a new flow means adding a field to
 * `Flows` below and nothing else.
 */
export interface Flows {
  login: LoginFlow;
  item: ItemFlow;
}

export interface FrameworkFixtures {
  log: Logger;
  screens: Screens;
  api: ApiFactory;
  flows: Flows;
  /** Namespaced Redis helper; its namespace is cleared after the test. */
  redis: RedisHelper;
}

export const test = base.extend<FrameworkFixtures>({
  log: async ({}, use, testInfo) => {
    const log = createLogger(testInfo.titlePath.join(' > '));
    log.info(`starting: ${testInfo.title}`);
    await use(log);
  },

  screens: async ({ page }, use) => {
    await use(new Screens(page));
  },

  api: async ({ request }, use) => {
    await use(new ApiFactory(request));
  },

  flows: async ({ screens, api }, use) => {
    const context = { screens, api };
    await use({
      login: new LoginFlow(context),
      item: new ItemFlow(context),
    });
  },

  redis: [
    async ({}, use) => {
      const helper = new RedisHelper('session');
      await use(helper);
      // Test isolation: drop everything written under this namespace.
      await helper.clearNamespace();
    },
    { auto: false },
  ],
});

export { expect };
