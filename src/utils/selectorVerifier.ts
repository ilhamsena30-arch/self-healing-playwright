/**
 * Verification gate for healed selectors (D2, D9-D12).
 *
 * Pure functions — no browser, no Redis, no network. The caller (Tier 4) resolves
 * the repaired selector to an element and supplies the resolved role / name / text
 * / same-role count; this module only decides whether the repair is trusted.
 *
 * Verdicts:
 *  - `verified`      expectations existed and were satisfied
 *  - `rejected`      expectations existed and were violated -> the test fails (D11)
 *  - `unverifiable`  no parseable semantics in the original selector (D4/D12) -> allowed, flagged
 */

export interface Expectations {
  role: string | null;
  /** Accessible name from a `name=` filter. */
  name: string | null;
  text: string | null;
  testId: string | null;
  attr: { name: string; value: string } | null;
  /** false => the original selector carries no semantics to verify against. */
  hasSemantics: boolean;
}

export type Verdict =
  | { status: 'verified'; reason: string }
  | { status: 'rejected'; reason: string }
  | { status: 'unverifiable'; reason: string };

/**
 * Parses a Playwright engine string (`locator._selector`) into the expectations the
 * original locator expressed. Only the shapes produced by `getBy*` (shown below)
 * carry semantics; raw CSS is deliberately left with `hasSemantics: false` (D4).
 */
export function parseExpectations(rawSelector: string): Expectations {
  const empty: Expectations = {
    role: null,
    name: null,
    text: null,
    testId: null,
    attr: null,
    hasSemantics: false,
  };

  const selector = rawSelector.trim();
  if (!selector.startsWith('internal:')) return empty;

  // internal:role=button[name="Log In"i]
  const roleMatch = selector.match(/^internal:role=([a-z0-9-]+)(?:\[name=(.+)\])?$/);
  if (roleMatch) {
    return {
      ...empty,
      role: roleMatch[1],
      name: roleMatch[2] ? decodeFilterValue(roleMatch[2]) : null,
      hasSemantics: true,
    };
  }

  // internal:text="Need help?"i
  const textMatch = selector.match(/^internal:text=(.+)$/);
  if (textMatch) {
    return { ...empty, text: decodeFilterValue(textMatch[1]), hasSemantics: true };
  }

  // internal:testid=[data-testid="login-form"s]
  const testIdMatch = selector.match(/^internal:testid=\[data-testid="(.+)"s\]$/);
  if (testIdMatch) {
    return { ...empty, testId: testIdMatch[1], hasSemantics: true };
  }

  // internal:label="Username"i
  const labelMatch = selector.match(/^internal:label=(.+)$/);
  if (labelMatch) {
    return { ...empty, name: decodeFilterValue(labelMatch[1]), hasSemantics: true };
  }

  // internal:attr=[placeholder="User Name"i]
  const attrMatch = selector.match(/^internal:attr=\[([a-z0-9-]+)=(.+)\]$/);
  if (attrMatch) {
    return {
      ...empty,
      attr: { name: attrMatch[1], value: decodeFilterValue(attrMatch[2]) },
      hasSemantics: true,
    };
  }

  // Unknown engine shape (e.g. internal:chain / internal:or) — no extractable
  // semantics, so treated as unverifiable rather than rejected (D12).
  return empty;
}

/**
 * Normalises a name/text for comparison (D10):
 *   1. lowercase
 *   2. replace every non-alphanumeric char with a space
 *   3. collapse runs of spaces, trim
 */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when two names are equivalent under D10: normalised equality, equality with
 * spaces removed, or token-subset in either direction.
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (na === nb) return true;
  if (na.replace(/\s+/g, '') === nb.replace(/\s+/g, '')) return true;

  const tokensA = new Set(na.split(' ').filter(Boolean));
  const tokensB = new Set(nb.split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  const aInB = [...tokensA].every((token) => tokensB.has(token));
  const bInA = [...tokensB].every((token) => tokensA.has(token));
  return aInB || bInA;
}

/**
 * Decides whether a repaired selector may be trusted. Verdict order follows the
 * locked rules: role must match (D9), a name mismatch is accepted only when the
 * repair is the sole element with that role, then name/text token comparison
 * (D10), then testId/attr presence.
 */
export function verifyRepair(args: {
  original: Expectations;
  repairedSelector: string;
  resolvedRole: string | null;
  sameRoleCount: number;
  resolvedName: string | null;
  resolvedText: string | null;
}): Verdict {
  const { original, repairedSelector, resolvedRole, sameRoleCount, resolvedName, resolvedText } =
    args;

  if (!original.hasSemantics) {
    return {
      status: 'unverifiable',
      reason: 'original selector has no parseable semantics',
    };
  }

  // 1. Role must match — a role mismatch is always a rejection (D9).
  if (original.role !== null) {
    if (!resolvedRole || normaliseName(resolvedRole) !== normaliseName(original.role)) {
      return {
        status: 'rejected',
        reason: `role mismatch (expected "${original.role}", resolved "${resolvedRole ?? 'none'}")`,
      };
    }
  }

  // 2. Role matches and the repair is the ONLY element with that role -> accept,
  //    even on a name mismatch. This is what lets a label rename heal (D9).
  if (original.role !== null && sameRoleCount === 1) {
    return { status: 'verified', reason: 'sole element with expected role' };
  }

  // 3. Name/text comparison (D10). When several elements share the role a name
  //    match is mandatory; fall back to text when the original carried no name.
  const expected = original.name ?? original.text;
  if (expected !== null) {
    const resolved = original.name !== null ? resolvedName : resolvedText;
    if (!resolved || !namesMatch(expected, resolved)) {
      return {
        status: 'rejected',
        reason: `name mismatch (expected "${expected}", resolved "${resolved ?? 'none'}")`,
      };
    }
  } else if (original.role !== null && sameRoleCount > 1) {
    // Role matches but several elements share it and there is no name to
    // distinguish them — the repair cannot be verified, so it must not be
    // trusted (D11).
    return {
      status: 'rejected',
      reason: `cannot verify which of ${sameRoleCount} same-role elements was intended`,
    };
  }

  // 4. testId / attr: the value must appear in the repaired selector or on the
  //    resolved element.
  if (original.testId !== null) {
    const inSelector = repairedSelector.includes(original.testId);
    if (!inSelector) {
      return {
        status: 'rejected',
        reason: `test id "${original.testId}" not found in repaired selector`,
      };
    }
  }
  if (original.attr !== null) {
    const inSelector = repairedSelector.includes(original.attr.value);
    if (!inSelector) {
      return {
        status: 'rejected',
        reason: `attribute ${original.attr.name}="${original.attr.value}" not found in repaired selector`,
      };
    }
  }

  return { status: 'verified', reason: 'role and name matched' };
}

/** Turns a `name=` filter value back into its literal text (strips quotes + flags). */
function decodeFilterValue(raw: string): string {
  const trimmed = raw.trim();

  // Regex filter: /sign in|log in/i -> "sign in|log in"
  if (trimmed.startsWith('/')) {
    const lastSlash = trimmed.lastIndexOf('/');
    return lastSlash > 0 ? trimmed.slice(1, lastSlash) : trimmed;
  }

  // Exact string: "Log In"i -> "Log In"
  if (trimmed.startsWith('"') && trimmed.length >= 2) {
    const end = trimmed.lastIndexOf('"');
    if (end > 0) {
      const body = trimmed.slice(1, end);
      // Trim the engine's trailing case flag, e.g. "Log In"i
      return body;
    }
  }

  return trimmed;
}
