import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { env } from './env.js';
import { createLogger, type Logger } from './logger.js';
import { TIMEOUTS } from './constants.js';

/**
 * Contract every ScreenPage (locator object) must satisfy.
 * The Flow layer only ever talks to the page through this interface,
 * so flows stay independent from the concrete locator implementation.
 */
export interface IScreen {
  /** Human readable screen name, used in logs and error messages. */
  readonly name: string;
  /** Relative route for this screen, e.g. `/login`. */
  readonly path: string;

  /** Navigate to the screen and wait until it is ready. */
  open(): Promise<void>;
  /** Assert the screen is currently displayed. */
  expectVisible(): Promise<void>;
  /** Wait until the screen finished loading all critical elements. */
  waitUntilReady(): Promise<void>;
}

/**
 * Base class for all screen objects.
 *
 * A `ScreenPage` is responsible for:
 *   1. Declaring **locators** (getters returning `Locator`s).
 *   2. Declaring **low-level actions** on those locators (`type`, `click`, ...).
 *   3. Knowing how to detect that it is loaded.
 *
 * It must NOT contain business flow logic or assertions about outcomes —
 * that belongs in a `Flow` class.
 */
export abstract class ScreenPage implements IScreen {
  abstract readonly name: string;
  abstract readonly path: string;

  protected readonly log: Logger;

  constructor(protected readonly page: Page) {
    this.log = createLogger(`screen:${this.constructor.name}`);
  }

  /** Elements that must be present for the screen to be considered loaded. */
  protected abstract readonly readyLocator: Locator;

  async open(): Promise<void> {
    await this.goto(this.path);
    await this.waitUntilReady();
  }

  async goto(path = this.path): Promise<void> {
    const url = `${env.baseUrl}${path}`;
    this.log.debug(`navigating to ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async gotoUrl(rawUrl: string): Promise<void> {
    this.log.debug(`navigating to absolute url ${rawUrl}`);
    await this.page.goto(rawUrl, { waitUntil: 'domcontentloaded' });
  }

  async waitUntilReady(timeout = TIMEOUTS.medium): Promise<void> {
    await this.readyLocator.waitFor({ state: 'visible', timeout });
  }

  async expectVisible(): Promise<void> {
    await expect(this.readyLocator, `Expected screen "${this.name}" to be visible`).toBeVisible();
  }

  // ---------------------------------------------------------------------------
  // Shared low-level actions. Extend as needed.
  // ---------------------------------------------------------------------------

  protected async fill(locator: Locator, value: string, label?: string): Promise<void> {
    this.log.debug(`fill ${label ?? 'field'} = "${maskIfSecret(value)}"`);
    await locator.waitFor({ state: 'visible' });
    await locator.fill(value);
  }

  protected async click(locator: Locator, label?: string): Promise<void> {
    this.log.debug(`click ${label ?? 'element'}`);
    await locator.waitFor({ state: 'visible' });
    await locator.click();
  }

  protected async textOf(locator: Locator): Promise<string> {
    return (await locator.innerText()).trim();
  }

  async title(): Promise<string> {
    return this.page.title();
  }
}

/** Masks a value so secrets never leak into logs. */
function maskIfSecret(value: string): string {
  return value.length > 6 ? `${value.slice(0, 2)}***${value.slice(-1)}` : '***';
}
