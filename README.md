# Self-Healing Playwright — UI Automation Boilerplate

A layered Playwright + TypeScript automation boilerplate covering:

| Layer | Purpose | Location |
| --- | --- | --- |
| **Flow** | Business logic & outcome assertions | `src/flow` |
| **ScreenPage** | Locators + low-level element actions | `src/screen` |
| **API** | REST calls via Playwright `APIRequestContext` | `src/api` |
| **Redis** | Test data cache / session seeding (`@upstash/redis`) | `src/redis` |
| **Core** | Env config, logging, base classes, constants | `src/core` |
| **Fixtures** | Playwright fixtures wiring everything together | `src/fixtures` |
| **Specs** | Test cases | `tests` |

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

1. **ScreenPage** knows *how* to find elements and type/click them.
2. **Flow** knows *what* steps form a business scenario, and asserts outcomes.
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
const cached = await sessionStore.get<{ token: string }>('current');  // auto-deserialised
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

| Variable | Default | Notes |
| --- | --- | --- |
| `BASE_URL` | `https://example.com` | UI target — replace |
| `API_BASE_URL` | `https://api.example.com` | API target — replace |
| `TEST_USERNAME` / `TEST_PASSWORD` | placeholders | Test account |
| `REDIS_URL` | `https://fluent-worm-177361.upstash.io` | Upstash REST URL |
| `REDIS_TOKEN` | *(empty)* | **Set via env/CI secrets — never commit** |
| `REDIS_KEY_PREFIX` | `e2e` | All test keys are namespaced with this |
| `REDIS_FLUSH_ON_START` | `false` | Wipe `e2e:*` keys during global setup |
| `WORKERS` / `RETRIES` / `TIMEOUT_MS` | `2` / `1` / `45000` | Runner tuning |

Config is validated at startup with Zod — an invalid `.env` fails fast with a readable error.

---

## Notes on Redis isolation (Upstash)

* Backed by `@upstash/redis` over HTTP — no local server, no connect/quit lifecycle.
* Credentials come from the environment: `REDIS_URL` (REST URL) and `REDIS_TOKEN`
  (REST token). The token is intentionally left empty in `.env.example`; supply it
  via your shell or CI secrets.
* Every helper is namespaced: `e2e:session:current`, `e2e:cart:item:42`, …
* The `redis` fixture clears its namespace **after** each test.
* `REDIS_FLUSH_ON_START=true` wipes all `e2e:*` keys once per run.
* Redis is **optional** — without `REDIS_TOKEN`, global setup skips the health
  check and API-only suites still run.

```ts
import { Redis } from '@upstash/redis';

const redis = new Redis({ url: process.env.REDIS_URL!, token: process.env.REDIS_TOKEN! });
await redis.set('foo', 'bar');
await redis.get('foo');
```

## Reporting

* `playwright-report/` — HTML report (`npm run report`)
* `test-results/results.json` — machine-readable results
* Traces, videos, and screenshots are retained on failure.
