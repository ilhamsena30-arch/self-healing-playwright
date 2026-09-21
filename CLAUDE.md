# CLAUDE.md

Playwright + TypeScript test suite. **UI target: `https://practice.expandtesting.com`.**

`README.md` is the architecture tour and holds copy-paste samples of every layer — read it once.
This file is the working agreement: where code goes, how to add and run a test, and the rules that
keep the suite self-healing.

## Stack

|          |                                                                                |
| -------- | ------------------------------------------------------------------------------ |
| Runtime  | Node >= 20, ESM (`"type": "module"`)                                           |
| Language | TypeScript strict, `moduleResolution: NodeNext`                                |
| Runner   | Playwright Test — projects `chromium`, `firefox`, `api`                        |
| Config   | `src/core/env.ts` validates `.env` with Zod and exposes the typed `env` object |
| Data     | Upstash Redis over HTTP (`src/redis`) — optional, no local server              |

- **Import `env`, never `process.env`.** Every variable is declared in `src/core/env.ts`; add yours
  there and it becomes typed everywhere.
- **Relative imports carry an explicit `.js` extension** (`'../../src/fixtures/index.js'`) — that is
  what NodeNext requires. The `@core/*`-style aliases in `tsconfig.json` exist but the suite does not
  use them; stay relative so there is one import style.

## Folder structure — where your code goes

```
tests/                    specs only: no locators, no process.env
  ui/*.ui.spec.ts         browser specs           → projects `chromium`, `firefox`
  api/*.api.spec.ts       HTTP specs, no browser  → project `api`
  global.setup.ts         target reachability + Redis health check, once per run
src/
  core/                   env, logger, constants, ScreenPage base class
  screen/                 ScreenPages — locators + low-level clicks/fills
  flow/                   Flows — business steps + outcome assertions
  api/                    ApiClient + endpoint services
  redis/                  namespaced Redis helpers
  fixtures/               the Playwright fixtures that specs import
  data/                   test-data factories
scripts/                  one-off tsx utilities
```

The spec suffix is load-bearing: the `api` project is selected by `testMatch: /.*\.api\.spec\.ts/`
and the browser projects ignore that pattern. A browser spec named `*.api.spec.ts` runs in the wrong
project.

| Adding…                                    | Touch                                                           |
| ------------------------------------------ | --------------------------------------------------------------- |
| an element or action on an existing screen | `src/screen/<name>.screen.ts`                                   |
| a screen                                   | new ScreenPage + one field in `Screens` (`src/screen/index.ts`) |
| a business scenario                        | `src/flow/<name>.flow.ts` + one field in the `flows` fixture    |
| an endpoint                                | `src/api/<name>.api.ts` + one field in `ApiFactory`             |
| a route, constant, or Redis namespace      | `src/core/constants.ts`                                         |
| reusable test data                         | `src/data/test-data.ts`                                         |

## Self-healing rules

1. **One place to break.** Locators live only in ScreenPages. Specs and Flows reach them through
   method calls, so a DOM change is a one-file, one-line fix rather than a sweep across the suite.
2. **Fallback chains.** Give every locator a flow depends on a primary anchor and a fallback joined
   with `.or()`, ordered stable → brittle. When the primary anchor changes, the locator heals itself
   and the run stays green:

   ```ts
   // Primary first, fallback second: Playwright uses the first one that resolves.
   this.userNameInput = page
     .getByPlaceholder('User Name')
     .or(page.locator('input[name="UserName"]'));
   this.submitButton = page.getByRole('button', { name: 'Log In' }).or(page.locator('#login'));
   ```

   Locators resolve in this order — the accessible tree outlives markup refactors, and a generated
   `id` (see `/dynamicid`) is the brittlest anchor on the playground:

   `getByRole` + name → `getByLabel` / `getByPlaceholder` → `getByText` → `getByTestId` → CSS.

3. **Heal at the layer that broke.** A locator failure is fixed in the ScreenPage; a wrong business
   outcome is fixed in the Flow. Repairs that add sleeps or raise retries move the break out of sight
   and make the next failure harder to read.
4. **Prove the heal on the failing spec.** Re-run that file, then the project. A heal no failing spec
   verifies is a guess.
5. **Runtime self-healing is repair-and-report, never auto-fix.** The LLM/stub runs during the run,
   caches a verified repair, and writes a `suggestedPatch` into `self-healing-report.jsonl` — it
   **never** edits `src/screen`. A repair that fails the verification gate **fails the test**
   (rejected), and a repair with no parseable semantics is cached but flagged `verified: false`
   (unverifiable). Rejected ≠ unverifiable. The `healedScreens` fixture is opt-in; the default
   `screens` fixture keeps using the raw page.

## How to write a test

1. Decide the layer with the table above. A new scenario is normally: one ScreenPage method → one
   Flow method → one spec.
2. **ScreenPage** — declare locators as `readonly` fields assigned in the constructor, add the
   low-level action, and set `readyLocator` to the element that proves the screen loaded.
3. **Flow** — compose screen calls into the business step and assert the outcome with `expect`. Wire
   a new flow into `Flows` in `src/fixtures/test.fixtures.ts`.
4. **Spec** — import `test`/`expect` from `src/fixtures`, call the flow, tag the `describe`.

```ts
import { test, expect } from '../../src/fixtures/index.js';

test.describe('Sample App @smoke', () => {
  test('a valid user logs in', async ({ flows }) => {
    await flows.sampleApp.login('admin', 'pwd');
    await expect(flows.sampleApp.ui.statusLabel).toHaveText('Welcome, admin!');
  });
});
```

Spec rules:

- Import from `../../src/fixtures/index.js`, not `@playwright/test` — the fixture `test` carries
  `flows`, `screens`, `api`, `redis`, and `log`.
- No locators, CSS, or XPath in a spec. Touching `screens` is fine for a screen-level control check.
- One behaviour per `test`; tag every `describe` with `@smoke`, `@regression`, or `@api`.
- Pass a message to `expect` when the assertion is a business outcome, so a failure names the step
  that broke: `expect(locator, 'item row should appear after save')`.

Done when: the spec passes in isolation, it contains no selector strings, and `npm run typecheck` is
clean.

## How to run a test

| Intent                          | Command                                         |
| ------------------------------- | ----------------------------------------------- |
| One file                        | `npx playwright test tests/ui/login.ui.spec.ts` |
| One test by title               | `npx playwright test -g "sign in"`              |
| One browser, headed             | `npm run test:headed`                           |
| API suite                       | `npm run test:api`                              |
| Tagged smoke suite              | `npm run test:smoke`                            |
| Unit tests (gate + cache keys)  | `npm run test:unit`                             |
| Step through with the inspector | `npm run test:debug`                            |
| Everything                      | `npm test`                                      |

- `--project=chromium\|firefox\|api` picks the target; the table's scripts are the common cases and
  `package.json` has the rest.
- Failures leave traces, video, and screenshots in `test-results/`; `npm run report` opens the HTML
  report in `playwright-report/`.
- Runner tuning comes from `.env` (`WORKERS`, `RETRIES`, `HEADLESS`, `TIMEOUT_MS`, `TRACE`,
  `VIDEO`) and reaches `playwright.config.ts` through `env`.

## Local environment setup

```bash
npm ci                        # Node 20+; npm install is fine if you are changing deps
npx playwright install        # add --with-deps on a fresh Linux image
cp .env.example .env          # .env is git-ignored — never commit it
```

1. `.env.example` and `.env` set `BASE_URL=https://practice.expandtesting.com`. The playground serves no
   REST API, so leave `API_BASE_URL` on a JSON API host (and retarget `src/api`) before relying on the
   `api` project.
2. Redis is optional. Leave `REDIS_TOKEN` empty and global setup skips the health check; suites that
   use the `redis` fixture need an Upstash REST URL **and** token. There is no local server to start —
   the client talks HTTP.
3. Verify with `npm run redis:ping`, then seed with `npm run seed` if you need cached data.
4. Sanity check: `npm run typecheck`, then `npm run test:api`.

## Code conventions

- **Files are camelCase, folders are kebab-case.** New files: `loginScreen.ts`, `itemFlow.ts`,
  `redisHelper.ts`, `globalSetup.ts`; new folders: `src/test-data/`, `tests/api-smoke/`.
- The kebab-case files already in the tree (`login.screen.ts`, `base.flow.ts`, `test-data.ts`) predate
  this rule — rename one to camelCase as you next touch it and update its imports in the same change.
  A pure case change needs two steps on Windows: `git mv a.ts tmp.ts` then `git mv tmp.ts A.ts`.
- Specs keep their two-part suffix: `<name>.ui.spec.ts` or `<name>.api.spec.ts`.
- `PascalCase` classes, `camelCase` methods and fields, and `SCREAMING_SNAKE_CASE` constants living in
  `src/core/constants.ts`.
- **Comments explain the why.** Put a one-or-two-line JSDoc block on every ScreenPage and Flow class
  and on any method a spec calls, saying what the step means in business terms. Use inline `//` for a
  workaround, a race, an ordering that matters, or where a magic number came from. When a comment only
  restates the line beneath it, rename the thing instead.
- Prettier (100 columns, single quotes, trailing commas) and ESLint hold the rest; run
  `npm run format` and `npm run lint` before you finish. `any` is a warning — prefer the types in
  `src/api/types.ts`.

## Gotchas

- **Assertions belong to Flows; ScreenPages only act.** A screen method that asserts an outcome makes
  the same failure appear in two layers.
- Playwright auto-waits. Wait on the state you actually need — `expect(locator).toBeVisible()`,
  `waitForResponse`, or the screen's `waitUntilReady()` — rather than on elapsed time.
- `uitestingplayground.com` has no login or dashboard: it is a set of standalone scenario pages. Give
  each ScreenPage the scenario's own `path` (`/sampleapp`, `/dynamicid`, `/alerts`, …).
- `/nbsp` demonstrates a non-breaking space defeating naive text matching — match with a regex.
  `/dynamicid` regenerates its element `id` on every load, so anchor on role and text.
- The `redis` fixture is opt-in and clears its namespace after each test.
- `envSchema` ignores unknown keys, so a misspelled variable silently falls back to its default. When a
  setting appears to have no effect, check the schema in `src/core/env.ts`.
- `globalSetup` / `globalTeardown` run once per test run. The comment in `playwright.config.ts` mentions
  a `setup` project that depends-on — there is no such project, so ordering between them is not
  enforced by the config.
- `forbidOnly` is on in CI: a stray `test.only` fails the build.

## Definition of done

- [ ] `npm run typecheck` and `npm run lint` are clean.
- [ ] `npm run test:unit` passes (gate + cache-key builder).
- [ ] The changed spec passes in isolation, then in its project.
- [ ] No locator strings outside `src/screen`; new screens and flows wired into `Screens` and `Flows`.
- [ ] Every `describe` carries a `@smoke` / `@regression` / `@api` tag.
- [ ] Comments explain the why; the code itself carries the what.
- [ ] A rejected self-healing repair fails the test (never silently green); an unverifiable one is
      flagged `verified: false`.
