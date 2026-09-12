import type { Page } from '@playwright/test';
import { LoginScreen } from './login.screen.js';
import { DashboardScreen } from './dashboard.screen.js';
import { CreateItemScreen } from './create-item.screen.js';

/**
 * Screen registry — the single place that knows how to construct every ScreenPage.
 *
 * Flows receive a `Screens` instance, so adding a new screen only requires
 * adding a field here; no flow construction code needs to change.
 */
export class Screens {
  readonly login: LoginScreen;
  readonly dashboard: DashboardScreen;
  readonly createItem: CreateItemScreen;

  constructor(readonly page: Page) {
    this.login = new LoginScreen(page);
    this.dashboard = new DashboardScreen(page);
    this.createItem = new CreateItemScreen(page);
  }
}

export { LoginScreen } from './login.screen.js';
export { DashboardScreen } from './dashboard.screen.js';
export { CreateItemScreen } from './create-item.screen.js';
