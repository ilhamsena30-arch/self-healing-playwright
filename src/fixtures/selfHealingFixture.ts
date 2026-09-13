import { test as base, expect } from '@playwright/test';
import type {
  Fixtures,
  FrameLocator,
  Locator,
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
} from '@playwright/test';
import { env } from '../core/env.js';
import { SELF_HEALING } from '../core/constants.js';
import { createLogger, type Logger } from '../core/logger.js';
import { healingCache, type HealingCache } from '../utils/redisClient.js';
import { isLlmConfigured, repairSelector } from '../utils/llmRepair.js';
import { pruneDom } from '../utils/domPruner.js';
import { logHealEvent } from '../utils/reportWriter.js';

/**
 * 4-tier self-healing fixture.
 *
 * Interactive Locator calls (`click`, `fill`, `type`, `selectOption`) are
 * intercepted with a Proxy and run through the healing tiers:
 *
 *   Tier 1  primary selector with a fast 2.5s timeout
 *   Tier 2  Redis `healed_locators` hash (memory fallback when Redis is down)
 *   Tier 3  DOM pruning + DeepSeek semantic repair (deepseek-chat)
 *   Tier 4  cache the successful repair + append to `self-healing-report.json`
 *
 * Assertions (`expect`) are deliberately left untouched: a Proxy-wrapped
 * Locator still satisfies Playwright's expect matchers, but we never intercept
 * the assertion calls themselves, so business regressions still fail loudly.
 */

// Symbol carrying the real Playwright selector on every wrapped Locator.
const kSelector = Symbol('selfHealing.selector');

/** Intercepted interactive methods. */
type InteractiveMethod = (typeof SELF_HEALING.interactiveMethods)[number];

/** Wrapped Locator type: keeps the public surface but lets us tag internals. */
type HealedLocator = Locator & { [kSelector]?: string };

/** Locator factory methods on Page/FrameLocator that we must re-wrap. */
const LOCATOR_FACTORIES = [
  'locator',
  'getByRole',
  'getByLabel',
  'getByPlaceholder',
  'getByText',
  'getByAltText',
  'getByTitle',
  'getByTestId',
] as const;

/** Pass-through methods that return a child locator scoped under the parent. */
const PASS_THROUGH_FACTORIES = ['filter', 'and', 'or', 'nth', 'first', 'last'] as const;

const log: Logger = createLogger('healing:fixture');

/** Structural type for the shared "heal a failed interaction" routine. */
interface HealContext {
  page: Page;
  log: Logger;
  cache: HealingCache;
  testName: string;
}

/** Interaction targets: the method + its arguments. */
interface Interaction {
  method: InteractiveMethod;
  args: unknown[];
}

/** Resolves an already-wrapped Locator (identity check) or derives from a raw one. */
function selectorOf(target: Locator): string | null {
  const tagged = target as HealedLocator;
  if (tagged[kSelector]) return tagged[kSelector];

  // Raw Playwright Locator: read the private field used by the runner.
  const raw = target as unknown as { _selector?: string };
  return typeof raw._selector === 'string' ? raw._selector : null;
}

/** Creates a new Playwright Locator for a healed selector string. */
function locatorFor(page: Page, selector: string): Locator {
  return page.locator(selector);
}

/**
 * Runs one interaction attempt with the 2.5s fail-fast timeout.
 * Returns true on success; false when it failed due to a locator timeout.
 */
async function attempt(
  target: Locator,
  method: InteractiveMethod,
  args: unknown[],
): Promise<{ ok: boolean; error?: unknown }> {
  try {
    const optionsIndex =
      method === 'fill' || method === 'type' || method === 'selectOption' ? 1 : 0;
    const arg = Array.isArray(args) ? args[optionsIndex] : undefined;
    const opts = (arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : {}) as Record<
      string,
      unknown
    >;
    const options = { ...opts, timeout: env.healing.timeoutMs };

    switch (method) {
      case 'click':
        await target.click(options);
        break;
      case 'fill':
        await target.fill(String(args[0]), options);
        break;
      case 'type':
        await target.type(String(args[0]), options);
        break;
      case 'selectOption':
        await target.selectOption(args[0] as Parameters<Locator['selectOption']>[0], options);
        break;
    }
    return { ok: true };
  } catch (error) {
    // Only locator-resolution failures are healable. Any other error (a raised
    // assertion, a navigation error, a thrown business error) must propagate.
    if (isLocatorTimeout(error)) return { ok: false, error };
    throw error;
  }
}

/**
 * True when the error is a locator-resolution timeout — the only failure class
 * that self-healing may silently repair. Assertions, strict-mode violations
 * (a locator that resolves to several elements), and navigation errors never
 * match this predicate, so business regressions still fail loudly.
 */
function isLocatorTimeout(error: unknown): boolean {
  if (error instanceof Error) {
    // Playwright's TimeoutError sets `name` in its CustomError base class.
    if (error.name === 'TimeoutError') return true;
    // Fallback: the message for a timed-out interaction always names the timeout.
    return /\bTimeout \d+ms exceeded/.test(error.message);
  }
  return false;
}

/** Tier 2: consult the Redis (or memory) cache for a previously healed selector. */
async function tryCached(
  ctx: HealContext,
  failed: string,
  interaction: Interaction,
): Promise<boolean> {
  const healed = await ctx.cache.get(failed);
  if (!healed) return false;

  ctx.log.info(`tier2: cached heal for "${failed}" -> "${healed}"`);
  const target = locatorFor(ctx.page, healed);
  const result = await attempt(target, interaction.method, interaction.args);
  if (result.ok) {
    ctx.log.info(`tier2: cached selector resolved the interaction`);
    return true;
  }
  return false;
}

/** Tier 3: prune the DOM and ask the LLM for a semantic repair. */
async function tryLlm(
  ctx: HealContext,
  failed: string,
  interaction: Interaction,
): Promise<boolean> {
  if (!isLlmConfigured()) {
    ctx.log.debug('tier3: skipped — DEEPSEEK_API_KEY is not configured');
    return false;
  }

  let prunedDom: string;
  try {
    prunedDom = await pruneDom(ctx.page);
  } catch (error) {
    ctx.log.warn(`tier3: DOM pruning failed: ${String(error)}`);
    return false;
  }

  const result = await repairSelector(failed, prunedDom);
  if (!result?.repairedSelector) return false;
  if (result.confidence < env.healing.confidenceThreshold) {
    ctx.log.warn(
      `tier3: repair below threshold (${result.confidence} < ${env.healing.confidenceThreshold}) — discarding`,
    );
    return false;
  }

  ctx.log.info(
    `tier3: LLM repair "${failed}" -> "${result.repairedSelector}" (confidence ${result.confidence})`,
  );
  const target = locatorFor(ctx.page, result.repairedSelector);
  const attemptResult = await attempt(target, interaction.method, interaction.args);
  if (!attemptResult.ok) return false;

  // Tier 4: cache the winning selector and write the audit entry.
  await ctx.cache.set(failed, result.repairedSelector);
  logHealEvent({
    test: ctx.testName,
    originalSelector: failed,
    repairedSelector: result.repairedSelector,
    confidence: result.confidence,
    reasoning: result.reasoning,
  });
  ctx.log.info('tier4: repair cached and logged to self-healing-report.json');
  return true;
}

/**
 * Wraps a Locator in a Proxy. Interactive methods run through the healing tiers;
 * every other member is forwarded to the real Locator (assertions included).
 */
function wrapLocator(locator: Locator, ctx: HealContext): Locator {
  const selector = selectorOf(locator);
  if (selector === null) return locator; // unsupported raw locator — leave untouched

  // Preserve expect() compatibility: the matchers look at `_apiName`.
  const apiName = (locator as unknown as { _apiName?: string })._apiName ?? 'Locator';

  return new Proxy(locator, {
    get(target, prop, receiver) {
      if (prop === kSelector) return selector;
      if (prop === '_apiName') return apiName;

      const value = Reflect.get(target, prop, receiver);

      // Re-wrap locator factories so every descendant stays healable.
      if (
        LOCATOR_FACTORIES.includes(prop as (typeof LOCATOR_FACTORIES)[number]) &&
        typeof value === 'function'
      ) {
        return (...args: unknown[]) => wrapLocator(value.apply(target, args), ctx);
      }

      // Scoping methods return a locator that must inherit the same interception.
      if (
        PASS_THROUGH_FACTORIES.includes(prop as (typeof PASS_THROUGH_FACTORIES)[number]) &&
        typeof value === 'function'
      ) {
        return (...args: unknown[]) => wrapLocator(value.apply(target, args), ctx);
      }

      // Interactive methods run through the 4-tier healing pipeline.
      if (
        SELF_HEALING.interactiveMethods.includes(prop as InteractiveMethod) &&
        typeof value === 'function'
      ) {
        return async (...args: unknown[]) => {
          const interaction: Interaction = { method: prop as InteractiveMethod, args };

          // Tier 1: fast-fail primary attempt.
          const first = await attempt(target, interaction.method, interaction.args);
          if (first.ok) return;

          ctx.log.warn(
            `tier1 failed for "${selector}" (${interaction.method}); attempting self-healing`,
          );

          // Tier 2: Redis/memory cache.
          if (await tryCached(ctx, selector, interaction)) return;

          // Tier 3 + 4: LLM repair, cache and report on success.
          if (await tryLlm(ctx, selector, interaction)) return;

          // Nothing healed — surface the original error so the failure is readable.
          if (first.error) throw first.error;
          throw new Error(
            `Locator "${selector}" could not be resolved or healed for ${interaction.method}.`,
          );
        };
      }

      // Bind any remaining functions to the real locator so `this` stays correct.
      // This is where `waitFor`, `count`, `_expect`, `textContent`, etc. land —
      // none of them are intercepted, so assertions keep their native behaviour.
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

/**
 * Wraps a Page in a Proxy so every Locator it produces is intercepted.
 * The `page` argument is the base fixture's real Page.
 */
function wrapPage(page: Page, ctx: HealContext): Page {
  return new Proxy(page, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        const key = prop as string;
        // Re-wrap locator factories that return a Locator/FrameLocator.
        if (LOCATOR_FACTORIES.includes(key as (typeof LOCATOR_FACTORIES)[number])) {
          return (...args: unknown[]) => {
            const created = value.apply(target, args) as Locator | FrameLocator;
            return wrapLocator(created as Locator, ctx);
          };
        }
        if (key === 'frameLocator') {
          return (...args: unknown[]) => {
            const frame = value.apply(target, args) as FrameLocator;
            return wrapFrameLocator(frame, ctx);
          };
        }
        return value.bind(target);
      }
      return value;
    },
  });
}

/** Wraps a FrameLocator so its locators are intercepted too. */
function wrapFrameLocator(frame: FrameLocator, ctx: HealContext): FrameLocator {
  return new Proxy(frame, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        const key = prop as string;
        if (LOCATOR_FACTORIES.includes(key as (typeof LOCATOR_FACTORIES)[number])) {
          return (...args: unknown[]) => {
            const created = value.apply(target, args) as Locator;
            return wrapLocator(created, ctx);
          };
        }
        if (key === 'frameLocator') {
          return (...args: unknown[]) =>
            wrapFrameLocator(value.apply(target, args) as FrameLocator, ctx);
        }
        return value.bind(target);
      }
      return value;
    },
  });
}

/**
 * Fixtures exposed to specs:
 *   - `healedPage`: the healing Page proxy (use instead of `page` for interactions)
 *   - `healing`:    introspect/control the healing runtime (cache + config)
 */
export interface SelfHealingFixtures {
  healedPage: Page;
  healing: {
    cache: HealingCache;
    timeoutMs: number;
    confidenceThreshold: number;
    llmConfigured: boolean;
  };
}

export const test = base.extend<SelfHealingFixtures>({
  healedPage: async ({ page }, use, testInfo) => {
    const ctx: HealContext = {
      page,
      log,
      cache: healingCache,
      testName: testInfo.titlePath.join(' > '),
    };
    const wrapped = wrapPage(page, ctx);
    await use(wrapped);
  },

  healing: async ({}, use) => {
    await use({
      cache: healingCache,
      timeoutMs: env.healing.timeoutMs,
      confidenceThreshold: env.healing.confidenceThreshold,
      llmConfigured: isLlmConfigured(),
    });
  },
});

export { expect };

/** Re-export for specs that import everything from one place. */
export type {
  Fixtures,
  Locator,
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
};
