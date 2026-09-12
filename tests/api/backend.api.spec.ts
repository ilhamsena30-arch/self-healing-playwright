import { test, expect } from '../../src/fixtures/index.js';
import { users, buildItemPayload } from '../../src/data/test-data.js';

/**
 * Pure API specs — no browser. They run under the `api` project, so
 * `request` is already pointed at `API_BASE_URL`.
 */
test.describe('Auth API @api', () => {
  test('login returns an access token for valid credentials', async ({ api }) => {
    const response = await api.auth.login(users.standard);

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.expiresIn).toBeGreaterThan(0);
  });

  test('login is rejected for invalid credentials', async ({ api }) => {
    const response = await api.auth.login(users.invalid);

    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test('a token from the cache can fetch the current profile', async ({ api }) => {
    const token = await api.auth.loginAndGetToken(users.standard);
    const response = await api.authenticated(token).auth.me(token);

    expect(response.ok).toBe(true);
    expect(response.body.email).toBeTruthy();
  });
});

test.describe('Items API @api', () => {
  test('an item can be created, fetched, and deleted', async ({ api }) => {
    const token = await api.auth.loginAndGetToken(users.standard);
    const authed = api.authenticated(token);
    const payload = buildItemPayload();

    const created = await authed.items.createOrThrow(payload);
    expect(created.id).toBeTruthy();

    const fetched = await authed.items.getById(created.id);
    expect(fetched.body.name).toBe(payload.name);

    const removed = await authed.items.remove(created.id);
    expect(removed.ok).toBe(true);
  });

  test('listing items returns a paginated envelope', async ({ api }) => {
    const token = await api.auth.loginAndGetToken(users.standard);
    const response = await api.authenticated(token).items.list({ page: 1, pageSize: 10 });

    expect(response.ok).toBe(true);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.page).toBe(1);
  });
});
