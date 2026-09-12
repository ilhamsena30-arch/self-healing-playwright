import type { Locator, Page } from '@playwright/test';
import { ScreenPage } from '../core/screen-page.js';

/**
 * ScreenPage for the login screen.
 * Only locators + low-level field actions live here — no flow logic.
 */
export class LoginScreen extends ScreenPage {
  readonly name = 'Login';
  readonly path = '/login';

  // --- Locators -----------------------------------------------------------------

  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorBanner: Locator;
  readonly rememberMeCheckbox: Locator;
  readonly forgotPasswordLink: Locator;
  readonly heading: Locator;
  protected readonly readyLocator: Locator;

  constructor(page: Page) {
    super(page);
    this.readyLocator = page.getByTestId('login-form');
    this.heading = page.getByRole('heading', { name: /sign in|log in/i });
    this.usernameInput = page.getByLabel(/username|email/i);
    this.passwordInput = page.getByLabel(/password/i);
    this.submitButton = page.getByRole('button', { name: /sign in|log in/i });
    this.errorBanner = page.getByTestId('login-error');
    this.rememberMeCheckbox = page.getByLabel(/remember me/i);
    this.forgotPasswordLink = page.getByRole('link', { name: /forgot password/i });
  }

  // --- Low-level field actions --------------------------------------------------

  async fillUsername(value: string): Promise<void> {
    await this.fill(this.usernameInput, value, 'username');
  }

  async fillPassword(value: string): Promise<void> {
    await this.fill(this.passwordInput, value, 'password');
  }

  async checkRememberMe(): Promise<void> {
    await this.click(this.rememberMeCheckbox, 'remember me');
  }

  /** Clicks submit without waiting for navigation (the flow decides what comes next). */
  async submit(): Promise<void> {
    await this.click(this.submitButton, 'submit');
  }

  /** Convenience: fill both fields and submit. */
  async submitCredentials(username: string, password: string): Promise<void> {
    await this.fillUsername(username);
    await this.fillPassword(password);
    await this.submit();
  }

  async errorMessage(): Promise<string> {
    await this.errorBanner.waitFor({ state: 'visible' });
    return this.textOf(this.errorBanner);
  }
}
