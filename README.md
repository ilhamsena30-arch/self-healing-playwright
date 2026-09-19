# Self-Healing Playwright — UI Automation Boilerplate

A layered Playwright + TypeScript automation boilerplate covering:

| Layer          | Purpose                                              | Location       |
| -------------- | ---------------------------------------------------- | -------------- |
| **Flow**       | Business logic & outcome assertions                  | `src/flow`     |
| **ScreenPage** | Locators + low-level element actions                 | `src/screen`   |
| **API**        | REST calls via Playwright `APIRequestContext`        | `src/api`      |
| **Redis**      | Test data cache / session seeding (`@upstash/redis`) | `src/redis`    |
| **Core**       | Env config, logging, base classes, constants         | `src/core`     |
| **Fixtures**   | Playwright fixtures wiring everything together       | `src/fixtures` |
| **Specs**      | Test cases                                           | `tests`        |

> All target URLs, credentials, and selectors are **placeholders** (`example.com`, `tester@example.com`).
> Replace them in `.env`, `src/data/test-data.ts`, and the screen objects.

---

## Architecture

```
tests/                     ← specs import fixtures only, never selectors
  ├─ ui/*.ui.spec.ts
  ├─ api/*.api.spec.ts
  ├─ global.setup.ts
  └─ global.teardown.ts

src/
  ├─ core/     env · logger · constants · ScreenPage base
  ├─ screen/   LoginScreen · DashboardScreen · CreateItemScreen · Screens registry
  ├─ flow/     BaseFlow · LoginFlow · ItemFlow
  ├─ api/      ApiClient · AuthApi · ItemsApi · ApiFactory · types
  ├─ redis/    client · RedisHelper · namespace stores
  ├─ fixtures/ Playwright fixtures (screens, api, flows, redis, log)
  └─ data/     test-data factories
```

### Flow — the only layer a spec talks to

```
Spec  →  Flow  →  ScreenPage (locators) + ApiClient + RedisHelper
```

1. **ScreenPage** knows _how_ to find elements and type/click them.
2. **Flow** knows _what_ steps form a business scenario, and asserts outcomes.
3. **API layer** seeds or verifies data without the browser.
4. **Redis layer** caches sessions/entities for cross-test reuse and isolation.

Adding a screen = one class + one field in `Screens`.
Adding a flow = one class + one field in the `flows` fixture.

---

## Getting started

```bash
npm install
npx playwright install            # download browsers
cp .env.example .env              # then edit placeholder values
                                  # set REDIS_TOKEN for Upstash

npm run redis:ping                # verify Upstash connectivity
npm run seed                      # optional: seed Redis fixtures

npm test                          # all projects
npm run test:ui                   # chromium UI specs only
npm run test:api                  # API specs only
npm run test:smoke                # @smoke tagged specs
npm run typecheck                 # tsc --noEmit
npm run report                    # open the HTML report
```

---

## Usage examples

### A UI spec (thin, no selectors)

```ts
import { test, expect } from '../../src/fixtures/index.js';
import { users } from '../../src/data/test-data.js';

test('valid user signs in', async ({ flows }) => {
  await flows.login.login(users.standard);
  await expect(flows.login.ui.dashboard.welcomeMessage).toBeVisible();
});
```

### A ScreenPage (locators only)

```ts
export class LoginScreen extends ScreenPage {
  readonly name = 'Login';
  readonly path = '/login';
  readonly usernameInput = this.page.getByLabel(/username|email/i);
  // ...
  async fillUsername(value: string) {
    await this.fill(this.usernameInput, value, 'username');
  }
}
```

### An API call

```ts
const token = await api.auth.loginAndGetToken(users.standard);
const items = await api.authenticated(token).items.list({ page: 1 });
```

### Redis (Upstash)

```ts
import { Redis } from '@upstash/redis';

// Raw client (token read from process env):
const redis = new Redis({ url: process.env.REDIS_URL!, token: process.env.REDIS_TOKEN! });
await redis.set('foo', 'bar');
await redis.get('foo');
```

```ts
// Or use the namespaced helper from the framework:
import { sessionStore, cartStore } from '../src/redis/index.js';

await sessionStore.set('current', { token }, { ttl: 600 });
const cached = await sessionStore.get<{ token: string }>('current'); // auto-deserialised
await cartStore.clearNamespace();
```

### The composite Flow (API + Redis + UI)

```ts
const item = await flows.item.seedViaApiThenVerifyInUi({ name: 'seeded', price: 9.99 });
// logs in via API → seeds item → caches in Redis → logs in via UI → asserts row visible
```

---

## Environment variables

See `.env.example` for the full list with defaults. Key ones:

| Variable                             | Default                                 | Notes                                     |
| ------------------------------------ | --------------------------------------- | ----------------------------------------- |
| `BASE_URL`                           | `https://example.com`                   | UI target — replace                       |
| `API_BASE_URL`                       | `https://api.example.com`               | API target — replace                      |
| `TEST_USERNAME` / `TEST_PASSWORD`    | placeholders                            | Test account                              |
| `REDIS_URL`                          | `https://fluent-worm-177361.upstash.io` | Upstash REST URL                          |
| `REDIS_TOKEN`                        | _(empty)_                               | **Set via env/CI secrets — never commit** |
| `REDIS_KEY_PREFIX`                   | `e2e`                                   | All test keys are namespaced with this    |
| `REDIS_FLUSH_ON_START`               | `false`                                 | Wipe `e2e:*` keys during global setup     |
| `WORKERS` / `RETRIES` / `TIMEOUT_MS` | `2` / `1` / `45000`                     | Runner tuning                             |

Config is validated at startup with Zod — an invalid `.env` fails fast with a readable error.

---

## Notes on Redis isolation (Upstash)

- Backed by `@upstash/redis` over HTTP — no local server, no connect/quit lifecycle.
- Credentials come from the environment: `REDIS_URL` (REST URL) and `REDIS_TOKEN`
  (REST token). The token is intentionally left empty in `.env.example`; supply it
  via your shell or CI secrets.
- Every helper is namespaced: `e2e:session:current`, `e2e:cart:item:42`, …
- The `redis` fixture clears its namespace **after** each test.
- `REDIS_FLUSH_ON_START=true` wipes all `e2e:*` keys once per run.
- Redis is **optional** — without `REDIS_TOKEN`, global setup skips the health
  check and API-only suites still run.

```ts
import { Redis } from '@upstash/redis';

const redis = new Redis({ url: process.env.REDIS_URL!, token: process.env.REDIS_TOKEN! });
await redis.set('foo', 'bar');
await redis.get('foo');
```

## Reporting

- `playwright-report/` — HTML report (`npm run report`)
- `test-results/results.json` — machine-readable results
- `self-healing-report.jsonl` — append-only NDJSON audit log of every heal attempt
  (applied, rejected, and unverified), one JSON object per line
- Traces, videos, and screenshots are retained on failure.

## Self-healing locators (4-tier)

Interactive locator calls can heal themselves without touching `expect()` assertions.

| Tier | What happens                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| 1    | Primary selector runs with a fail-fast timeout (`HEALING_TIMEOUT_MS`, default 2500).                        |
| 2    | Namespaced Redis cache (`{prefix}:heal:{version}:{ENV}:{path}:{sha1}`) is checked.                          |
| 3    | DOM is pruned to interactive elements and the provider (`deepseek` or `stub`) proposes a repaired selector. |
| 4    | Verification gate checks confidence + uniqueness + semantic equivalence, then caches and reports.           |

`click`, `fill`, `type`, `selectOption`, and `waitFor` are intercepted. Assertions are
never modified — a true business regression still fails loudly.

### The verification gate

A repair is **persisted only** if it passes all of (D2):

1. confidence ≥ `HEALING_CONFIDENCE_THRESHOLD` (default 0.8),
2. resolves to **exactly one** element,
3. role matches the original selector, and
4. name/text matches under normalised comparison — a name mismatch is accepted only
   when the repaired element is the **only** element with that role.

Three outcomes, and they are **not** interchangeable:

- **verified** — expectations existed and were satisfied. Trusted.
- **rejected** — expectations existed and were violated. The test **fails** (D11) with a
  `healing-diagnostics.json` attachment containing the pruned DOM, the model's reasoning,
  and the rejection reason.
- **unverifiable** — the original selector had no parseable semantics (e.g. a bare CSS
  id). The heal is cached but flagged `verified: false` and logged as a warning (D4).

A rejected repair is **not** written to Redis. A wrong heal can never silently go green.

### Opting in

Healing is opt-in. The default `screens` fixture uses the raw page; the `healedScreens`
fixture builds the same ScreenPages on the healing proxy:

```ts
import { test, expect } from '../../src/fixtures/selfHealingFixture.js';

test('uses the healing screens', async ({ healedScreens }) => {
  await healedScreens.login.open();
  await healedScreens.login.submit();
});
```

`tests/ui/healing.ui.spec.ts` (tagged `@regression`) exercises the whole path offline via
the stub provider.

### Configuration

| Variable                       | Default                    | Notes                                                                                                 |
| ------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `HEALING_REDIS_URL`            | _(derived)_                | ioredis URI; falls back to `rediss://…` from `REDIS_URL`+`REDIS_TOKEN`, then `redis://localhost:6379` |
| `HEALING_REDIS_PASSWORD`       | _(empty)_                  | password for the local Redis fallback                                                                 |
| `HEALING_PROVIDER`             | `deepseek`                 | `deepseek` (real LLM) or `stub` (deterministic, offline)                                              |
| `HEALING_STUB_SELECTOR`        | _(empty)_                  | selector the stub provider returns                                                                    |
| `HEALING_STUB_CONFIDENCE`      | `0.95`                     | confidence the stub provider reports                                                                  |
| `HEALING_CACHE_TTL_SECONDS`    | `604800`                   | per-key cache TTL (7 days); `0`/`-1` disables expiry                                                  |
| `DEEPSEEK_API_KEY`             | _(empty)_                  | empty disables the deepseek provider                                                                  |
| `DEEPSEEK_MODEL`               | `deepseek-chat`            | model used for semantic repair                                                                        |
| `DEEPSEEK_BASE_URL`            | `https://api.deepseek.com` | DeepSeek is OpenAI-compatible; the `openai` SDK targets this URL                                      |
| `HEALING_CONFIDENCE_THRESHOLD` | `0.8`                      | minimum confidence to auto-apply a repair                                                             |
| `HEALING_TIMEOUT_MS`           | `2500`                     | fail-fast timeout per attempt                                                                         |

Redis is optional: if the connection fails or is unconfigured, healing degrades
to the in-memory cache without crashing the run. The cache is cleared once in
global setup; the TTL is a leak backstop for runs that die before teardown.

```bash
# Offline verification — no network, no tokens:
HEALING_PROVIDER=stub HEALING_STUB_SELECTOR="button[name='submit-login']" \
  npx playwright test tests/ui/healing.ui.spec.ts --project=chromium
```

Unit tests for the gate and the cache-key builder run with `npm run test:unit`
(`node:test` + `tsx`, no browser).
