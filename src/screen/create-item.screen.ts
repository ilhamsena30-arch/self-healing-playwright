import type { Locator, Page } from '@playwright/test';
import { ScreenPage } from '../core/screen-page.js';

/** ScreenPage for the modal/panel used to create a new item. */
export class CreateItemScreen extends ScreenPage {
  readonly name = 'CreateItem';
  /** Rendered as an overlay on the dashboard, not a standalone route. */
  readonly path = '/dashboard';

  // --- Locators -----------------------------------------------------------------

  readonly nameInput: Locator;
  readonly descriptionInput: Locator;
  readonly priceInput: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly validationMessage: Locator;
  protected readonly readyLocator: Locator;

  constructor(page: Page) {
    super(page);
    this.readyLocator = page.getByRole('dialog', { name: /create item|new item/i });
    this.nameInput = this.readyLocator.getByLabel(/name/i);
    this.descriptionInput = this.readyLocator.getByLabel(/description/i);
    this.priceInput = this.readyLocator.getByLabel(/price/i);
    this.saveButton = this.readyLocator.getByRole('button', { name: /save|create/i });
    this.cancelButton = this.readyLocator.getByRole('button', { name: /cancel/i });
    this.validationMessage = this.readyLocator.getByTestId('form-error');
  }

  // --- Low-level actions --------------------------------------------------------

  async fillName(value: string): Promise<void> {
    await this.fill(this.nameInput, value, 'item name');
  }

  async fillDescription(value: string): Promise<void> {
    await this.fill(this.descriptionInput, value, 'description');
  }

  async fillPrice(value: number | string): Promise<void> {
    await this.fill(this.priceInput, String(value), 'price');
  }

  async save(): Promise<void> {
    await this.click(this.saveButton, 'save');
  }

  async cancel(): Promise<void> {
    await this.click(this.cancelButton, 'cancel');
  }

  async fillForm(data: { name: string; description?: string; price: number }): Promise<void> {
    await this.fillName(data.name);
    if (data.description) await this.fillDescription(data.description);
    await this.fillPrice(data.price);
  }
}
