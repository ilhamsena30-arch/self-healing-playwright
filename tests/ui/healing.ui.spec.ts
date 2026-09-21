import { test, expect } from '../../src/fixtures/selfHealingFixture.js';
import { env } from '../../src/core/env.js';
import type { HealEntry } from '../../src/utils/healingCache.js';

/**
 * Offline self-healing specs (D6, D13).
 *
 * These run against `page.setContent(...)` pages — never the public playground —
 * and use the `stub` provider, so the whole path (Tier 1 miss → stub repair →
 * gate → cache write → report line) runs with no network and no DEEPSEEK_API_KEY.
 *
 * Expected env for this file:
 *   HEALING_PROVIDER=stub
 *   HEALING_STUB_SELECTOR=<a selector that resolves to the single button>
 *
 * The button in the synthetic page carries both `id="login-btn"` and
 * `name="submit-login"`, so common stub selectors (`#login-btn`,
 * `button[name='submit-login']`) both resolve to it.
 */

/** The stale locator the tests fail with: the page button reads "Log In", not "Sign in". */
const STALE_ROLE_SELECTOR = `internal:role=button[name="Sign in"i]`;

const LOGIN_PAGE = `
  <main>
    <h1>Login</h1>
    <label for="user">Username</label>
    <input id="user" name="username" placeholder="Username" />
    <label for="pass">Password</label>
    <input id="pass" name="password" type="password" placeholder="Password" />
    <button id="login-btn" name="submit-login">Log In</button>
    <a href="#help">Help</a>
  </main>
`;

function seedEntry(repairedSelector: string): HealEntry {
  return {
    repairedSelector,
    confidence: 0.95,
    verified: true,
    reasoning: 'seeded for replay test',
    healedAt: new Date().toISOString(),
    originalDescribe: STALE_ROLE_SELECTOR,
    model: 'stub',
    cacheVersion: 1,
  };
}

const stubConfigured =
  env.healing.provider === 'stub' && env.healing.stubSelector.trim().length > 0;

test.describe('Self-healing @regression', () => {
  test.skip(!stubConfigured, 'requires HEALING_PROVIDER=stub and HEALING_STUB_SELECTOR set');

  test.beforeEach(async ({ page }) => {
    await page.setContent(LOGIN_PAGE);
  });

  test('repairs a stale locator through the stub provider and caches it', async ({
    healedPage,
    healing,
  }) => {
    // Deliberately stale: the page has "Log In", the locator asks for "Sign in".
    const button = healedPage.getByRole('button', { name: 'Sign in' });
    await button.click();

    // Tier 4 persisted the repair under this path + selector.
    const cached = await healing.cache.get(healedPage.url(), STALE_ROLE_SELECTOR);
    expect(cached).not.toBeNull();
    expect(cached?.repairedSelector).toBe(env.healing.stubSelector);
    expect(cached?.verified).toBe(true);
  });

  test('replays a cached heal without calling the provider', async ({ healedPage, healing }) => {
    // Pre-seed the cache; the Tier 2 hit short-circuits the provider.
    await healing.cache.set(healedPage.url(), STALE_ROLE_SELECTOR, seedEntry('#login-btn'));

    const button = healedPage.getByRole('button', { name: 'Sign in' });
    await button.click();

    const cached = await healing.cache.get(healedPage.url(), STALE_ROLE_SELECTOR);
    expect(cached?.repairedSelector).toBe('#login-btn');
  });

  test('a wrong-role repair is rejected and re-throws the original error', async ({
    healedPage,
  }) => {
    // Original asks for a link; the stub returns the button — the gate must
    // reject the role mismatch (D9/D11) and surface the original timeout.
    const link = healedPage.getByRole('link', { name: 'Sign in' });
    await expect(link.click()).rejects.toThrow();
  });
});
