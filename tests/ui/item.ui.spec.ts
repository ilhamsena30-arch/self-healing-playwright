import { test, expect } from '../../src/fixtures/index.js';
import { buildItemPayload } from '../../src/data/test-data.js';
import { cartStore } from '../../src/redis/index.js';

/**
 * UI specs for item management, including the API + Redis + UI composite flow.
 */
test.describe('Items @regression', () => {
  test.beforeEach(async ({ flows }) => {
    await flows.login.login();
  });

  test('a user can create an item through the UI', async ({ flows, screens }) => {
    const payload = buildItemPayload();

    await flows.item.createItemViaUiAndVerify(payload);

    await expect(screens.dashboard.rowByName(payload.name)).toBeVisible();
  });

  test('an item seeded via API is visible in the UI', async ({ flows }) => {
    const payload = buildItemPayload({ description: 'Seeded through the API layer' });

    const created = await flows.item.seedViaApiThenVerifyInUi(payload);

    expect(created.id).toBeTruthy();
    await expect(flows.item.ui.dashboard.rowByName(created.name)).toBeVisible();
  });

  test('the created item payload is cached in redis', async ({ flows, redis }) => {
    const payload = buildItemPayload();
    await flows.item.createItemViaUiAndVerify(payload);

    const cached = await cartStore.get(payload.name);
    expect(cached).toMatchObject({ name: payload.name });
    expect(redis).toBeDefined();
  });
});
