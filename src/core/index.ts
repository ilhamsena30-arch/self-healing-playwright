import type { Locator } from '@playwright/test';
import type { AppEnv } from './env.js';

/** Re-export the typed env so tests/flows can import from a single place. */
export type { AppEnv };

/**
 * Poll an async predicate until it returns true (or the timeout elapses).
 */
export async function waitForCondition(
  predicate: () => Promise<boolean> | boolean,
  { timeout = 10_000, interval = 250, message = 'condition not met' } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out after ${timeout}ms waiting for: ${message}${last ? ` (last error: ${String(last)})` : ''}`);
}

/** Add an auth cookie to the current browser context. */
export async function setAuthCookie(
  locatorOwner: { context(): { addCookies(cookies: { name: string; value: string; domain: string; path: string }[]): Promise<void> } },
  name: string,
  value: string,
  domain: string,
): Promise<void> {
  await locatorOwner.context().addCookies([{ name, value, domain, path: '/' }]);
}

/** Type guard used by flows when a locator may or may not exist. */
export async function isAttached(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0;
}
