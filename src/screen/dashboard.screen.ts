import type { Locator, Page } from '@playwright/test';
import { ScreenPage } from '../core/screen-page.js';

/** ScreenPage for the authenticated dashboard. */
export class DashboardScreen extends ScreenPage {
  readonly name = 'Dashboard';
  readonly path = '/dashboard';

  // --- Locators -----------------------------------------------------------------

  readonly welcomeMessage: Locator;
  readonly userMenuButton: Locator;
  readonly logoutMenuItem: Locator;
  readonly itemList: Locator;
  readonly itemRows: Locator;
  readonly createItemButton: Locator;
  readonly searchInput: Locator;
  readonly loadingSpinner: Locator;
  protected readonly readyLocator: Locator;

  constructor(page: Page) {
    super(page);
    this.readyLocator = page.getByTestId('dashboard-root');
    this.welcomeMessage = page.getByTestId('welcome-message');
    this.userMenuButton = page.getByTestId('user-menu-trigger');
    this.logoutMenuItem = page.getByRole('menuitem', { name: /log ?out|sign ?out/i });
    this.itemList = page.getByTestId('item-list');
    this.itemRows = this.itemList.locator('[data-testid="item-row"]');
    this.createItemButton = page.getByRole('button', { name: /create item|new item/i });
    this.searchInput = page.getByPlaceholder(/search/i);
    this.loadingSpinner = page.getByTestId('global-loader');
  }

  // --- Locators scoped to a single row -----------------------------------------

  rowByName(name: string): Locator {
    return this.itemRows.filter({ hasText: name });
  }

  // --- Low-level actions --------------------------------------------------------

  async openUserMenu(): Promise<void> {
    await this.click(this.userMenuButton, 'user menu');
  }

  async clickLogout(): Promise<void> {
    await this.openUserMenu();
    await this.click(this.logoutMenuItem, 'logout');
  }

  async search(term: string): Promise<void> {
    await this.fill(this.searchInput, term, 'search');
  }

  async clickCreateItem(): Promise<void> {
    await this.click(this.createItemButton, 'create item');
  }

  /** Waits for the initial data load to settle (spinner hidden). */
  async waitForContent(): Promise<void> {
    await this.loadingSpinner.waitFor({ state: 'hidden' }).catch(() => undefined);
  }

  async welcomeText(): Promise<string> {
    return this.textOf(this.welcomeMessage);
  }
}
