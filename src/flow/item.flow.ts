import { expect } from '@playwright/test';
import { BaseFlow, credentialsFromEnv } from './base.flow.js';
import { cartStore } from '../redis/index.js';
import type { CatalogItem, CreateItemPayload } from '../api/types.js';

/**
 * Item management flow.
 *
 * Demonstrates the three layers cooperating:
 *  - API layer     : seeds/creates data directly.
 *  - Screen layer  : drives the UI to create an item.
 *  - Redis layer   : caches and cross-checks the created entity.
 */
export class ItemFlow extends BaseFlow {
  /** Creates an item through the UI, starting from the dashboard. */
  async createItemViaUi(payload: CreateItemPayload): Promise<void> {
    this.log.info(`creating item via UI: ${payload.name}`);
    await this.screens.dashboard.clickCreateItem();
    await this.screens.createItem.waitUntilReady();
    await this.screens.createItem.fillForm({
      name: payload.name,
      description: payload.description,
      price: payload.price,
    });
    await this.screens.createItem.save();
  }

  /**
   * Creates an item through the UI and asserts it appears in the list,
   * while also caching the payload in Redis for downstream assertions.
   */
  async createItemViaUiAndVerify(payload: CreateItemPayload): Promise<void> {
    await this.createItemViaUi(payload);
    await expect(this.screens.dashboard.rowByName(payload.name)).toBeVisible();
    await cartStore.set(`item:${payload.name}`, payload, { ttl: 300 });
  }

  /** Seeds an item through the API and returns the server-side representation. */
  async seedItemViaApi(payload: CreateItemPayload, token?: string): Promise<CatalogItem> {
    const api = token ? this.api.authenticated(token) : this.api;
    const item = await api.items.createOrThrow(payload);
    this.log.info(`seeded item ${item.id} via API`);
    await cartStore.set(`item:${item.id}`, item, { ttl: 600 });
    return item;
  }

  /**
   * End-to-end composite flow:
   *  - logs in via API and caches the token,
   *  - seeds an item through the API,
   *  - logs in via the UI,
   *  - asserts the seeded item is visible in the UI.
   *
   * This is the pattern that shows how API + Redis + UI cooperate in one flow.
   */
  async seedViaApiThenVerifyInUi(payload: CreateItemPayload): Promise<CatalogItem> {
    const token = await this.loginViaApi(credentialsFromEnv());
    const item = await this.seedItemViaApi(payload, token);

    await this.loginViaUi(credentialsFromEnv());
    await this.screens.dashboard.search(item.name);
    await this.screens.dashboard.waitForContent();
    await expect(this.screens.dashboard.rowByName(item.name)).toBeVisible();

    return item;
  }

  /** Asserts that a previously created item is listed in the dashboard. */
  async expectItemVisible(name: string): Promise<void> {
    await this.screens.dashboard.search(name);
    await this.screens.dashboard.waitForContent();
    await expect(this.screens.dashboard.rowByName(name)).toBeVisible();
  }
}
