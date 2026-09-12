import { expect } from '@playwright/test';
import { BaseFlow, credentialsFromEnv } from './base.flow.js';
import type { Credentials } from '../api/types.js';

/**
 * Authentication flow.
 *
 * Encapsulates all login/logout business steps. Tests only call these methods,
 * never individual screens.
 */
export class LoginFlow extends BaseFlow {
  /**
   * Full happy-path login:
   *  1. Open the login screen.
   *  2. Submit credentials.
   *  3. Assert the dashboard loaded and shows the user.
   */
  async login(credentials: Credentials = credentialsFromEnv()): Promise<void> {
    await this.screens.login.open();
    await this.screens.login.expectVisible();
    await this.screens.login.submitCredentials(credentials.username, credentials.password);
    await this.screens.dashboard.waitUntilReady();
    this.log.info(`login succeeded for ${credentials.username}`);
  }

  /** Logs in and asserts the dashboard welcome message contains the username. */
  async loginAndVerify(credentials: Credentials = credentialsFromEnv()): Promise<void> {
    await this.login(credentials);
    await this.expectLoggedInAs(credentials.username);
  }

  /**
   * Attempts a login that is expected to fail.
   * Returns the error message shown to the user.
   */
  async loginExpectingFailure(credentials: Credentials): Promise<string> {
    await this.screens.login.open();
    await this.screens.login.submitCredentials(credentials.username, credentials.password);
    const message = await this.screens.login.errorMessage();
    this.log.info(`login rejected as expected: "${message}"`);
    return message;
  }

  /** Logs in through the UI, then hydrates Redis with the session record. */
  async loginAndCacheSession(credentials: Credentials = credentialsFromEnv()): Promise<string> {
    await this.login(credentials);
    const token = await this.loginViaApi(credentials);
    return token;
  }

  /** Logs out through the UI and asserts we land back on the login screen. */
  async logout(): Promise<void> {
    await this.screens.dashboard.clickLogout();
    await this.screens.login.waitUntilReady();
    await expect(this.screens.login.submitButton).toBeVisible();
  }
}
