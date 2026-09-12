import { test, expect } from '../../src/fixtures/index.js';
import { users } from '../../src/data/test-data.js';

/**
 * UI specs for the login flow.
 * Notice how thin these are: assertions and intent only, no selectors.
 */
test.describe('Login @smoke', () => {
  test('a valid user can sign in and reach the dashboard', async ({ flows }) => {
    await flows.login.login(users.standard);
    await expect(flows.login.ui.dashboard.welcomeMessage).toBeVisible();
  });

  test('an invalid password is rejected with an error message', async ({ flows }) => {
    const message = await flows.login.loginExpectingFailure(users.invalid);
    expect(message.length).toBeGreaterThan(0);
  });

  test('the login screen exposes the expected controls', async ({ screens }) => {
    await screens.login.open();
    await screens.login.expectVisible();
    await expect(screens.login.usernameInput).toBeVisible();
    await expect(screens.login.passwordInput).toBeVisible();
    await expect(screens.login.submitButton).toBeEnabled();
  });

  test('a signed-in user can sign out', async ({ flows }) => {
    await flows.login.login(users.standard);
    await flows.login.logout();
  });
});
