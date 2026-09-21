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
  TestInfo,
} from '@playwright/test';
import { env } from '../core/env.js';
import { SELF_HEALING } from '../core/constants.js';
import { createLogger, type Logger } from '../core/logger.js';
import {
  healingCache,
  pathnameOf,
  type HealEntry,
  type HealingCache,
} from '../utils/healingCache.js';
import { isLlmConfigured, providerName, repairSelector } from '../utils/healingProvider.js';
import { pruneDom } from '../utils/domPruner.js';
import { logHealEvent, type SuggestedPatch } from '../utils/reportWriter.js';
import { parseExpectations, verifyRepair, type Verdict } from '../utils/selectorVerifier.js';
import { Screens } from '../screen/index.js';

/**
 * 4-tier self-healing fixture.
 *
 * Interactive Locator calls (`click`, `fill`, `type`, `selectOption`, `waitFor`)
 * are intercepted with a Proxy and run through the healing tiers:
 *
 *   Tier 1  primary selector with a fast fail-fast timeout
 *   Tier 2  namespaced Redis cache (memory fallback when Redis is down)
 *   Tier 3  DOM pruning + repair provider (`deepseek` or `stub`)
 *   Tier 4  verification gate -> persist (verified / unverifiable) or reject (D11)
 *
 * Assertions (`expect`) are deliberately left untouched: a Proxy-wrapped Locator
 * still satisfies Playwright's expect matchers, but we never intercept the
 * assertion calls themselves, so business regressions still fail loudly.
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

/** `waitFor` states whose timeout means the element is still PRESENT — never healable. */
const ABSENCE_STATES = new Set(['hidden', 'detached']);

const log: Logger = createLogger('healing:fixture');

/** Structural type for the shared "heal a failed interaction" routine. */
interface HealContext {
  page: Page;
  log: Logger;
  cache: HealingCache;
  testName: string;
  testInfo: TestInfo;
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

/** Merges the caller's options with the fail-fast healing timeout. */
function withTimeout(arg: unknown, timeout: number): Record<string, unknown> {
  const opts = (arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : {}) as Record<
    string,
    unknown
  >;
  return { ...opts, timeout };
}

/**
 * Runs one interaction attempt with the fail-fast timeout.
 * Returns true on success; false when it failed due to a locator timeout.
 */
async function attempt(
  target: Locator,
  method: InteractiveMethod,
  args: unknown[],
): Promise<{ ok: boolean; error?: unknown }> {
  try {
    switch (method) {
      case 'click':
        await target.click(withTimeout(args[0], env.healing.timeoutMs));
        break;
      case 'fill':
        await target.fill(String(args[0]), withTimeout(args[1], env.healing.timeoutMs));
        break;
      case 'type':
        await target.type(String(args[0]), withTimeout(args[1], env.healing.timeoutMs));
        break;
      case 'selectOption':
        await target.selectOption(
          args[0] as Parameters<Locator['selectOption']>[0],
          withTimeout(args[1], env.healing.timeoutMs),
        );
        break;
      case 'waitFor': {
        const arg = (args[0] ?? {}) as { state?: 'attached' | 'detached' | 'visible' | 'hidden' };
        const state = arg.state ?? 'visible';
        await target.waitFor({ state, timeout: env.healing.timeoutMs });
        break;
      }
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
 * match this predicate, so business regressions still fail loudly (D5).
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
  const healed = await ctx.cache.get(ctx.page.url(), failed);
  if (!healed) return false;

  ctx.log.info(`tier2: cached heal for "${failed}" -> "${healed.repairedSelector}"`);
  const target = locatorFor(ctx.page, healed.repairedSelector);
  const result = await attempt(target, interaction.method, interaction.args);
  if (result.ok) {
    ctx.log.info(`tier2: cached selector resolved the interaction`);
    return true;
  }
  return false;
}

/**
 * Resolves a repaired selector to the semantic facts the gate needs.
 *
 * This is the design's single swappable seam: it approximates the accessible
 * role/name rather than computing the real accessibility tree. Replace it with
 * `ariaSnapshot()` later without touching the verdict logic (§10 open item 1).
 */
async function resolveRepairFacts(
  page: Page,
  repairedSelector: string,
): Promise<{
  count: number;
  role: string | null;
  sameRoleCount: number;
  name: string | null;
  text: string | null;
}> {
  const locator = page.locator(repairedSelector);
  const count = await locator.count();
  if (count !== 1) {
    return { count, role: null, sameRoleCount: 0, name: null, text: null };
  }

  const { role, name, text } = await locator.evaluate((node) => {
    const tag = (node.tagName ?? '').toLowerCase();
    const explicit = node.getAttribute('role');

    const implicitRole = (): string | null => {
      switch (tag) {
        case 'button':
          return 'button';
        case 'a':
          return node.hasAttribute('href') ? 'link' : null;
        case 'img':
          return node.hasAttribute('alt') ? 'img' : null;
        case 'input': {
          const type = (node.getAttribute('type') ?? 'text').toLowerCase();
          if (type === 'checkbox' || type === 'radio') return type;
          if (['submit', 'reset', 'button', 'image'].includes(type)) return 'button';
          return 'textbox';
        }
        case 'select':
          return 'combobox';
        case 'textarea':
          return 'textbox';
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
          return 'heading';
        case 'nav':
          return 'navigation';
        case 'main':
          return 'main';
        case 'table':
          return 'table';
        case 'ul':
        case 'ol':
          return 'list';
        case 'li':
          return 'listitem';
        case 'dialog':
          return 'dialog';
        default:
          return null;
      }
    };

    const accessibleName = (): string | null => {
      const aria = node.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const labelledBy = node.getAttribute('aria-labelledby');
      if (labelledBy) {
        const id = labelledBy.trim().split(/\s+/)[0];
        const ref = id ? document.getElementById(id) : null;
        if (ref && ref.textContent?.trim()) return ref.textContent.trim();
      }
      if (tag === 'input') {
        const placeholder = node.getAttribute('placeholder');
        if (placeholder && placeholder.trim()) return placeholder.trim();
      }
      if (tag === 'img') {
        const alt = node.getAttribute('alt');
        if (alt && alt.trim()) return alt.trim();
      }
      const text = (node.textContent ?? '').trim();
      return text ? text.slice(0, 100) : null;
    };

    return {
      role: explicit ?? implicitRole(),
      name: accessibleName(),
      text: (node.textContent ?? '').trim().slice(0, 100) || null,
    };
  });

  const sameRoleCount = role ? await page.locator(`internal:role=${role}`).count() : 0;
  return { count, role, sameRoleCount, name, text };
}

/** Best-effort ScreenPage file for the report's `suggestedPatch.file` (advisory). */
function screenFileForPath(pathname: string): string | null {
  const segment = pathname.replace(/^\/+/, '').split('/')[0];
  if (!segment || segment === '__unknown__') return null;
  if (/[^a-z0-9-]/i.test(segment)) return null;
  return `src/screen/${segment}.screen.ts`;
}

/** Builds the `.or()`-chained `suggestedPatch.after` expression (D8). */
function buildSuggestedPatch(
  originalSelector: string,
  repairedSelector: string,
  url: string,
): SuggestedPatch {
  const file = screenFileForPath(pathnameOf(url));
  const before = originalSelector;
  const after = `page.locator(${JSON.stringify(repairedSelector)}).or(page.locator(${JSON.stringify(originalSelector)}))`;
  return { file, before, after };
}

/** Attaches pruned DOM + reasoning + rejection reason as a test attachment (D7). */
async function attachDiagnostics(
  ctx: HealContext,
  details: {
    originalSelector: string;
    repairedSelector: string | null;
    confidence: number;
    reasoning: string;
    prunedDom: string | null;
    reason: string;
  },
): Promise<void> {
  try {
    await ctx.testInfo.attach('healing-diagnostics.json', {
      body: JSON.stringify(
        {
          originalSelector: details.originalSelector,
          repairedSelector: details.repairedSelector,
          confidence: details.confidence,
          reasoning: details.reasoning,
          rejectionReason: details.reason,
          prunedDom: details.prunedDom ? JSON.parse(details.prunedDom) : null,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } catch (error) {
    ctx.log.warn(`failed to attach healing diagnostics: ${String(error)}`);
  }
}

/** Tier 3 + 4: prune the DOM, ask the provider, gate the result, persist + report. */
async function tryRepair(
  ctx: HealContext,
  failed: string,
  interaction: Interaction,
): Promise<boolean> {
  let prunedDom: string;
  try {
    prunedDom = await pruneDom(ctx.page);
  } catch (error) {
    ctx.log.warn(`tier3: DOM pruning failed: ${String(error)}`);
    return false;
  }

  const result = await repairSelector(failed, prunedDom);
  if (!result?.repairedSelector || !result.confidence) {
    // No proposal (provider unconfigured/failed). Surface the original error.
    ctx.log.warn('tier3: provider returned no repair');
    return false;
  }

  // A proposal the gate refuses is a FAILURE (D11): record it, attach the
  // diagnostics, and let the caller re-throw the original Playwright error.
  const reject = async (reason: string): Promise<boolean> => {
    logHealEvent({
      test: ctx.testName,
      originalSelector: failed,
      repairedSelector: result.repairedSelector as string,
      confidence: result.confidence,
      verified: false,
      reasoning: result.reasoning,
      applied: false,
      reason,
      url: ctx.page.url(),
      model: providerName(),
    });
    await attachDiagnostics(ctx, {
      originalSelector: failed,
      repairedSelector: result.repairedSelector,
      confidence: result.confidence,
      reasoning: result.reasoning,
      prunedDom,
      reason,
    });
    ctx.log.error(`tier4: repair rejected — ${reason}`);
    return false;
  };

  if (result.confidence < env.healing.confidenceThreshold) {
    return reject(
      `confidence ${result.confidence} below threshold ${env.healing.confidenceThreshold}`,
    );
  }

  // Tier 4 — verification gate (D2): uniqueness, then role/name semantics.
  const facts = await resolveRepairFacts(ctx.page, result.repairedSelector);
  if (facts.count !== 1) {
    return reject(`repaired selector resolves to ${facts.count} elements (expected exactly 1)`);
  }

  const verdict: Verdict = verifyRepair({
    original: parseExpectations(failed),
    repairedSelector: result.repairedSelector,
    resolvedRole: facts.role,
    sameRoleCount: facts.sameRoleCount,
    resolvedName: facts.name,
    resolvedText: facts.text,
  });

  if (verdict.status === 'rejected') {
    return reject(verdict.reason);
  }

  const verified = verdict.status === 'verified';
  ctx.log.info(
    `tier3: repair "${failed}" -> "${result.repairedSelector}" (${verdict.status}: ${verdict.reason})`,
  );

  const target = locatorFor(ctx.page, result.repairedSelector);
  const attemptResult = await attempt(target, interaction.method, interaction.args);
  if (!attemptResult.ok) {
    return reject('interaction failed after a verified repair');
  }

  // Tier 4: cache the winning selector (post-verification, D2) and report it.
  const entry: HealEntry = {
    repairedSelector: result.repairedSelector,
    confidence: result.confidence,
    verified,
    reasoning: result.reasoning,
    healedAt: new Date().toISOString(),
    originalDescribe: failed,
    model: providerName(),
    cacheVersion: SELF_HEALING.cacheVersion,
  };
  await ctx.cache.set(ctx.page.url(), failed, entry);

  logHealEvent({
    test: ctx.testName,
    originalSelector: failed,
    repairedSelector: result.repairedSelector,
    confidence: result.confidence,
    verified,
    reasoning: result.reasoning,
    applied: true,
    url: ctx.page.url(),
    model: providerName(),
    suggestedPatch: buildSuggestedPatch(failed, result.repairedSelector, ctx.page.url()),
  });

  if (!verified) {
    // D4: cached, but flagged and never treated as trusted.
    ctx.log.warn(
      `heal for "${failed}" is unverifiable (no parseable semantics) — cached with verified:false; fix the locator to use a semantic anchor`,
    );
  }
  ctx.log.info('tier4: repair cached and logged');
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
          // A timeout waiting for ABSENCE means the element is still present, not
          // a broken locator — repairing it would invert the call's intent.
          if (prop === 'waitFor') {
            const arg = (args[0] ?? {}) as { state?: string };
            const state = arg.state ?? 'visible';
            if (ABSENCE_STATES.has(state)) {
              return value.apply(target, args);
            }
          }

          const interaction: Interaction = { method: prop as InteractiveMethod, args };

          // Tier 1: fast-fail primary attempt.
          const first = await attempt(target, interaction.method, interaction.args);
          if (first.ok) return;

          ctx.log.warn(
            `tier1 failed for "${selector}" (${interaction.method}); attempting self-healing`,
          );

          // Tier 2: Redis/memory cache.
          if (await tryCached(ctx, selector, interaction)) return;

          // Tier 3 + 4: repair, gate, cache and report on success.
          if (await tryRepair(ctx, selector, interaction)) return;

          // Nothing healed — surface the original error so the failure is readable.
          if (first.error) throw first.error;
          throw new Error(
            `Locator "${selector}" could not be resolved or healed for ${interaction.method}.`,
          );
        };
      }

      // Bind any remaining functions to the real locator so `this` stays correct.
      // This is where `count`, `_expect`, `textContent`, etc. land — none of them
      // are intercepted, so assertions keep their native behaviour.
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
          // D15: frame-scoped locators are never healed. The proxy would extract a
          // frame-relative selector and later re-create it against `page`, resolving
          // the wrong frame — so we return the raw frame locator and warn.
          return (...args: unknown[]) => {
            ctx.log.warn(
              `frameLocator("${String(args[0] ?? '')}") — frame-scoped locators are not healable (D15); skipping healing`,
            );
            return value.apply(target, args) as FrameLocator;
          };
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
 *   - `healedScreens`: ScreenPage instances built on `healedPage` (opt-in, D6)
 *   - `healing`:     introspect/control the healing runtime (cache + config)
 */
export interface SelfHealingFixtures {
  healedPage: Page;
  healedScreens: Screens;
  healing: {
    cache: HealingCache;
    timeoutMs: number;
    confidenceThreshold: number;
    llmConfigured: boolean;
    provider: string;
  };
}

export const test = base.extend<SelfHealingFixtures>({
  healedPage: async ({ page }, use, testInfo) => {
    const ctx: HealContext = {
      page,
      log,
      cache: healingCache,
      testName: testInfo.titlePath.join(' > '),
      testInfo,
    };
    const wrapped = wrapPage(page, ctx);
    await use(wrapped);
  },

  healedScreens: async ({ healedPage }, use) => {
    await use(new Screens(healedPage));
  },

  healing: async ({}, use) => {
    await use({
      cache: healingCache,
      timeoutMs: env.healing.timeoutMs,
      confidenceThreshold: env.healing.confidenceThreshold,
      llmConfigured: isLlmConfigured(),
      provider: env.healing.provider,
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
