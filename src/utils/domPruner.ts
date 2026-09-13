import type { Page } from '@playwright/test';

/**
 * DOM pruner for the self-healing LLM repair tier.
 *
 * The script below runs *inside the browser* via `page.evaluate` and reduces the
 * current document to only the elements a locator can realistically target, so
 * the LLM prompt stays small and cheap:
 *   - keep  `button`, `a`, `input`, `select`, `textarea`, `[role="button"]`, `[data-testid]`
 *   - keep  `id`, `class`, `name`, `aria-label`, `data-*` and a <=30 char text snippet
 *   - drop  structural tags (`div`, `span`, `section`, …), `<script>`, `<style>` and inline SVGs
 */

/** Shape of a single pruned element, mirrored by the in-page script. */
export interface PrunedElement {
  tag: string;
  id?: string;
  class?: string;
  name?: string;
  ariaLabel?: string;
  attrs: Record<string, string>;
  text?: string;
  children: PrunedElement[];
}

const PRUNE_SCRIPT = `() => {
  const INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea']);
  const KEEP_ATTRS = ['id', 'class', 'name', 'aria-label', 'role', 'type', 'href', 'placeholder', 'value'];
  const SKIP_TAGS = new Set(['script', 'style', 'svg', 'path', 'noscript', 'template', 'head', 'link', 'meta', 'title']);

  function visibleText(node) {
    // Direct text only — leaf labels matter for getByText/getByRole matching.
    const text = Array.from(node.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join(' ')
      .replace(/\\s+/g, ' ')
      .trim();
    return text.slice(0, 30);
  }

  function prune(node) {
    const out = { tag: '', attrs: {}, children: [] };
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    if (SKIP_TAGS.has(tag)) return null;

    const isInteractive =
      INTERACTIVE.has(tag) || node.getAttribute('role') === 'button' || node.hasAttribute('data-testid');
    const text = visibleText(node);

    const hasKeepableAttr = KEEP_ATTRS.some((name) => node.hasAttribute(name));
    const hasDataAttr = Array.from(node.attributes || []).some((a) => a.name.startsWith('data-'));
    const children = Array.from(node.children || []).map(prune).filter(Boolean);

    // Keep an element only when it is interactive, carries a useful attribute,
    // or wraps something useful. Everything else is pruned away.
    if (!isInteractive && !hasKeepableAttr && !hasDataAttr && children.length === 0 && !text) {
      return null;
    }

    if (tag) out.tag = tag;
    if (node.hasAttribute('id')) out.id = node.getAttribute('id');
    if (node.hasAttribute('class')) out.class = node.getAttribute('class');
    if (node.hasAttribute('name')) out.name = node.getAttribute('name');
    if (node.hasAttribute('aria-label')) out.ariaLabel = node.getAttribute('aria-label');
    for (const a of Array.from(node.attributes || [])) {
      if (a.name.startsWith('data-') || KEEP_ATTRS.includes(a.name)) out.attrs[a.name] = a.value;
    }
    if (text) out.text = text;
    if (children.length) out.children = children;
    return out;
  }

  const root = prune(document.body || document.documentElement);
  return { url: location.href, title: document.title, root: root ? [root] : [] };
}`;

/**
 * Runs the pruning script in the browser and returns the pruned interactive DOM
 * as JSON. Serialising here keeps the page-boundary transfer type-safe.
 */
export async function pruneDom(page: Page): Promise<string> {
  const result = await page.evaluate(PRUNE_SCRIPT);
  return JSON.stringify(result, null, 2);
}
