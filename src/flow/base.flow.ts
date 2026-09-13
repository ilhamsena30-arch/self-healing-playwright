import { expect } from '@playwright/test';
import type { Screens } from '../screen/index.js';
import type { ApiFactory } from '../api/index.js';
import { sessionStore } from '../redis/index.js';
import { createLogger, type Logger } from '../core/logger.js';
import { env } from '../core/env.js';
import type { Credentials, UserProfile } from '../api/types.js';

export interface FlowContext {
  screens: Screens;
  api: ApiFactory;
}

/**
 * Base class for business flows.
 *
 * A Flow owns *what* happens (business steps and outcome assertions) while
 * delegating *how* to ScreenPages (locators) and endpoint services (API).
 * Flows never touch selectors or raw HTTP.
 */
export abstract class BaseFlow {
  protected readonly log: Logger;
  protected readonly screens: Screens;
  protected readonly api: ApiFactory;

  constructor(protected readonly ctx: FlowContext) {
    this.screens = ctx.screens;
    this.api = ctx.api;
    this.log = createLogger(`flow:${this.constructor.name}`);
  }

  /**
   * Read-only view of the screens this flow drives.
   * Exposed so specs can do lightweight assertions without duplicating locators.
   */
  get ui(): Screens {
    return this.screens;
  }

  // ---------------------------------------------------------------------------
  // Cross-cutting flow helpers
  // ---------------------------------------------------------------------------

  /**
   * Logs in through the UI and caches the resulting session in Redis so that
   * later tests (or the API layer) can reuse it without re-authenticating.
   */
  protected async loginViaUi(credentials: Credentials): Promise<void> {
    this.log.info(`logging in via UI as ${credentials.username}`);
    await this.screens.login.open();
    await this.screens.login.submitCredentials(credentials.username, credentials.password);
    await this.screens.dashboard.waitUntilReady();
  }

  /**
   * Logs in through the API and returns the bearer token, seeding it into
   * Redis under the `session` namespace.
   */
  protected async loginViaApi(credentials: Credentials, cacheKey = 'current'): Promise<string> {
    this.log.info(`logging in via API as ${credentials.username}`);
    const token = await this.api.auth.loginAndGetToken(credentials);
    await sessionStore.set(
      cacheKey,
      { token, username: credentials.username, createdAt: Date.now() },
      { ttl: 600 },
    );
    return token;
  }

  /** Reads a cached token from Redis, refreshing it via API if absent/expired. */
  protected async getOrCreateToken(
    credentials: Credentials,
    cacheKey = 'current',
  ): Promise<string> {
    const cached = await sessionStore.get<{ token: string }>(cacheKey);
    if (cached?.token) {
      this.log.debug(`reusing cached token for ${credentials.username}`);
      return cached.token;
    }
    return this.loginViaApi(credentials, cacheKey);
  }

  /** Loads the current user's profile, using the cached/created token. */
  protected async loadProfile(cacheKey = 'current'): Promise<UserProfile> {
    const token = await this.getOrCreateToken(credentialsFromEnv(), cacheKey);
    const response = await this.api.authenticated(token).auth.me(token);
    if (!response.ok) {
      throw new Error(`Failed to load profile (status ${response.status})`);
    }
    return response.body;
  }

  /** Asserts the dashboard is showing the expected welcome text. */
  protected async expectLoggedInAs(username: string): Promise<void> {
    await this.screens.dashboard.expectVisible();
    await expect(this.screens.dashboard.welcomeMessage).toContainText(username);
  }
}

/** Convenience accessor so flows can default to the configured test user. */
export function credentialsFromEnv(): Credentials {
  return { username: env.username, password: env.password };
}
