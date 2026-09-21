import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '../core/env.js';
import { createLogger, type Logger } from '../core/logger.js';

/**
 * Repair provider abstraction (D13).
 *
 * Tier 3 asks a provider for a repaired selector string. Two implementations:
 *   - `deepseek` — the real LLM via the OpenAI-compatible DeepSeek endpoint.
 *   - `stub`     — deterministic, offline: returns the queued repair so CI can
 *                  exercise Tiers 2-4 with no network and no tokens.
 *
 * Providers return `null` on any failure (or when unconfigured) so the fixture
 * can surface the original Playwright error instead of masking it with a
 * secondary one. Providers never return a `getBy*` call — only a selector STRING.
 */

export interface RepairResult {
  reasoning: string;
  repairedSelector: string | null;
  confidence: number;
}

export interface RepairProvider {
  readonly name: string;
  repair(failedSelector: string, prunedDom: string): Promise<RepairResult | null>;
}

const log: Logger = createLogger('healing:provider');

// ---------------------------------------------------------------------------
// DeepSeek provider
// ---------------------------------------------------------------------------

const repairSchema = z.object({
  reasoning: z.string(),
  repaired_selector: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = `You repair broken Playwright locators for a test-automation suite.
Given (1) the selector that failed to resolve and (2) a pruned snapshot of the page's interactive DOM, produce a corrected Playwright selector.
Rules:
- Reply with a single JSON object and nothing else, using exactly these keys: "reasoning" (string), "repaired_selector" (string or null), "confidence" (number between 0 and 1).
- "repaired_selector" must be a selector STRING that is valid as the argument to page.locator(...). Examples: CSS like "#username" or "[data-testid='login']", or Playwright engine selectors like "text=Login". Returning JavaScript method calls such as getByRole(...) is NOT allowed.
- If no plausible replacement exists, set "repaired_selector" to null and "confidence" to 0.
- Prefer stable anchors in this order: id, data-testid, name, aria-label, then text or CSS.
- Set "confidence" between 0 and 1 reflecting how certain you are the replacement targets the same element.

Example response:
{"reasoning":"The login button id changed; matching by name is stable.","repaired_selector":"button[name='submit-login']","confidence":0.92}`;

let client: OpenAI | null = null;

/** Lazily constructs the DeepSeek client; returns null when no key is configured. */
function getClient(): OpenAI | null {
  if (client) return client;
  if (!env.healing.deepseekApiKey) return null;
  client = new OpenAI({
    apiKey: env.healing.deepseekApiKey,
    baseURL: env.healing.deepseekBaseUrl,
  });
  return client;
}

/** True when a DeepSeek API key is configured (kept for the fixture's diagnostics). */
export function isLlmConfigured(): boolean {
  return env.healing.deepseekApiKey.trim().length > 0;
}

async function repairWithDeepseek(
  failedSelector: string,
  prunedDom: string,
): Promise<RepairResult | null> {
  const deepseek = getClient();
  if (!deepseek) return null;

  const userPrompt = [
    'Failed selector:',
    failedSelector,
    '',
    'Pruned DOM snapshot:',
    prunedDom.slice(0, 20_000), // keep the prompt bounded regardless of page size
  ].join('\n');

  try {
    const completion = await deepseek.chat.completions.create({
      model: env.healing.deepseekModel,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;

    const parsed = repairSchema.parse(JSON.parse(raw));
    return {
      reasoning: parsed.reasoning,
      repairedSelector: parsed.repaired_selector,
      confidence: parsed.confidence,
    };
  } catch (error) {
    log.warn(`deepseek repair failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stub provider
// ---------------------------------------------------------------------------

async function repairWithStub(
  failedSelector: string,
  _prunedDom: string,
): Promise<RepairResult | null> {
  if (!env.healing.stubSelector) return null;
  log.debug(`stub provider returning queued repair for "${failedSelector}"`);
  return {
    reasoning: 'stub',
    repairedSelector: env.healing.stubSelector,
    confidence: env.healing.stubConfidence,
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const providers: Record<string, RepairProvider> = {
  deepseek: { name: 'deepseek', repair: repairWithDeepseek },
  stub: { name: 'stub', repair: repairWithStub },
};

/** The provider selected by `HEALING_PROVIDER` (default `deepseek`). */
export function getProvider(): RepairProvider {
  return providers[env.healing.provider] ?? providers.deepseek;
}

/** Tier 3 entry point: returns a repair or `null` (never throws). */
export async function repairSelector(
  failedSelector: string,
  prunedDom: string,
): Promise<RepairResult | null> {
  const provider = getProvider();
  return provider.repair(failedSelector, prunedDom);
}

/** The model/name to record against a heal (report + cache). */
export function providerName(): string {
  const provider = getProvider();
  return provider.name === 'deepseek' ? env.healing.deepseekModel : provider.name;
}
