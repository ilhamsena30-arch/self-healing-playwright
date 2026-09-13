import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '../core/env.js';
import { createLogger, type Logger } from '../core/logger.js';

/**
 * LLM semantic-repair client (Tier 3).
 *
 * Sends the failed selector plus a pruned DOM snippet to DeepSeek and asks for a
 * replacement Playwright selector. DeepSeek exposes an OpenAI-compatible API, so
 * the official `openai` SDK is reused with a custom base URL rather than adding a
 * second HTTP client. The response is requested as JSON and validated with Zod,
 * then the caller applies the guardrail (confidence >= threshold, non-null selector).
 */

export interface RepairResult {
  reasoning: string;
  repairedSelector: string | null;
  confidence: number;
}

const log: Logger = createLogger('healing:llm');

/** Zod schema mirroring the required LLM output contract. */
const repairSchema = z.object({
  reasoning: z.string(),
  repaired_selector: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

// DeepSeek has no `json_schema` structured-output mode, so the exact shape is
// spelled out here and enforced by Zod after parsing.
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

/**
 * Lazily constructs the DeepSeek client; returns null when no key is configured.
 * DeepSeek is OpenAI-compatible, so the OpenAI SDK talks to it via `baseURL`.
 */
function getClient(): OpenAI | null {
  if (client) return client;
  if (!env.healing.deepseekApiKey) return null;
  client = new OpenAI({
    apiKey: env.healing.deepseekApiKey,
    baseURL: env.healing.deepseekBaseUrl,
  });
  return client;
}

export function isLlmConfigured(): boolean {
  return env.healing.deepseekApiKey.trim().length > 0;
}

/**
 * Calls the LLM for a repaired selector. Returns `null` on any failure
 * (network, auth, schema mismatch) so the fixture can surface the original
 * Playwright error instead of masking it with a secondary one.
 */
export async function repairSelector(
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
      // DeepSeek supports JSON mode but not OpenAI's `json_schema` structured
      // outputs; the exact shape is described in the prompt and Zod-validated
      // below.
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
    log.warn(`LLM repair failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
