import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExpectations,
  verifyRepair,
  normaliseName,
  namesMatch,
} from '../../src/utils/selectorVerifier.js';
import { buildHealingKey, pathnameOf } from '../../src/utils/healingCache.js';

/**
 * Unit tests for the self-healing verification gate and cache key builder.
 * Pure functions — no browser, no Redis, no network. Run with `npm run test:unit`.
 */

describe('parseExpectations', () => {
  it('extracts role + name from a role engine string', () => {
    const exp = parseExpectations('internal:role=button[name="Log In"i]');
    assert.equal(exp.hasSemantics, true);
    assert.equal(exp.role, 'button');
    assert.equal(exp.name, 'Log In');
  });

  it('extracts role + name from a regex role engine string', () => {
    const exp = parseExpectations('internal:role=heading[name=/sign in|log in/i]');
    assert.equal(exp.role, 'heading');
    assert.equal(exp.name, 'sign in|log in');
  });

  it('extracts role with no name', () => {
    const exp = parseExpectations('internal:role=button');
    assert.equal(exp.hasSemantics, true);
    assert.equal(exp.role, 'button');
    assert.equal(exp.name, null);
  });

  it('extracts text from a text engine string', () => {
    const exp = parseExpectations('internal:text="Need help?"i');
    assert.equal(exp.hasSemantics, true);
    assert.equal(exp.text, 'Need help?');
  });

  it('extracts testId from a testid engine string', () => {
    const exp = parseExpectations('internal:testid=[data-testid="login-form"s]');
    assert.equal(exp.testId, 'login-form');
  });

  it('extracts name from a label engine string', () => {
    const exp = parseExpectations('internal:label="Username"i');
    assert.equal(exp.name, 'Username');
  });

  it('extracts attr from an attr engine string', () => {
    const exp = parseExpectations('internal:attr=[placeholder="User Name"i]');
    assert.deepEqual(exp.attr, { name: 'placeholder', value: 'User Name' });
  });

  it('treats bare CSS as unverifiable (hasSemantics false)', () => {
    const exp = parseExpectations('#gen-4821');
    assert.equal(exp.hasSemantics, false);
  });

  it('treats CSS attribute selectors as unverifiable', () => {
    const exp = parseExpectations("button[name='submit-login']");
    assert.equal(exp.hasSemantics, false);
  });
});

describe('normaliseName / namesMatch', () => {
  it('normalises case, punctuation and whitespace', () => {
    assert.equal(normaliseName('Log In'), 'log in');
    assert.equal(normaliseName('Log-In'), 'log in');
    assert.equal(normaliseName('Login'), 'login');
  });

  it('matches exact equality after normalisation', () => {
    assert.equal(namesMatch('log in', 'log  in'), true);
  });

  it('matches when spaces are removed', () => {
    assert.equal(namesMatch('log in', 'login'), true);
  });

  it('matches token-subset in either direction', () => {
    assert.equal(namesMatch('save', 'save changes'), true);
    assert.equal(namesMatch('save changes', 'save'), true);
  });

  it('rejects unrelated names', () => {
    assert.equal(namesMatch('log in', 'cancel'), false);
  });
});

describe('verifyRepair', () => {
  const baseArgs = {
    repairedSelector: "button[name='submit-login']",
    resolvedRole: 'button',
    sameRoleCount: 1,
    resolvedName: 'Log In',
    resolvedText: 'Log In',
  };

  it('rejects a role mismatch', () => {
    const verdict = verifyRepair({
      original: parseExpectations('internal:role=button[name="Log In"i]'),
      ...baseArgs,
      resolvedRole: 'link',
    });
    assert.equal(verdict.status, 'rejected');
  });

  it('accepts a name mismatch when the repair is the sole element with the role', () => {
    const verdict = verifyRepair({
      original: parseExpectations('internal:role=button[name="Submit"i]'),
      ...baseArgs,
      resolvedName: 'Save',
      sameRoleCount: 1,
    });
    assert.equal(verdict.status, 'verified');
  });

  it('rejects a name mismatch when several elements share the role', () => {
    const verdict = verifyRepair({
      original: parseExpectations('internal:role=button[name="Submit"i]'),
      ...baseArgs,
      resolvedName: 'Save',
      sameRoleCount: 3,
    });
    assert.equal(verdict.status, 'rejected');
  });

  it('verifies a normalised-equal name ("Log In" vs "Login")', () => {
    const verdict = verifyRepair({
      original: parseExpectations('internal:role=button[name="Log In"i]'),
      ...baseArgs,
      resolvedName: 'Login',
    });
    assert.equal(verdict.status, 'verified');
  });

  it('verifies a token-subset name', () => {
    const verdict = verifyRepair({
      original: parseExpectations('internal:role=button[name="Save"i]'),
      ...baseArgs,
      resolvedName: 'Save changes',
    });
    assert.equal(verdict.status, 'verified');
  });

  it('treats a bare CSS selector as unverifiable, never rejected', () => {
    const verdict = verifyRepair({
      original: parseExpectations('#gen-4821'),
      ...baseArgs,
      resolvedRole: 'button',
    });
    assert.equal(verdict.status, 'unverifiable');
  });

  it('rejects a testId absent from the repaired selector', () => {
    const verdict = verifyRepair({
      original: parseExpectations('internal:testid=[data-testid="login-form"s]'),
      repairedSelector: "button[name='submit-login']",
      resolvedRole: null,
      sameRoleCount: 0,
      resolvedName: null,
      resolvedText: null,
    });
    assert.equal(verdict.status, 'rejected');
  });
});

describe('healingKey / pathnameOf', () => {
  it('derives pathname from a full URL', () => {
    assert.equal(pathnameOf('https://example.com/login?next=/x'), '/login');
  });

  it('falls back to __unknown__ for about:blank', () => {
    assert.equal(pathnameOf('about:blank'), '__unknown__');
  });

  it('builds different keys for the same selector on two paths', () => {
    const a = buildHealingKey('e2e', 1, 'local', '/login', 'abc123');
    const b = buildHealingKey('e2e', 1, 'local', '/dashboard', 'abc123');
    assert.notEqual(a, b);
  });

  it('builds different keys for the same selector in two ENVs', () => {
    const a = buildHealingKey('e2e', 1, 'local', '/login', 'abc123');
    const b = buildHealingKey('e2e', 1, 'ci', '/login', 'abc123');
    assert.notEqual(a, b);
  });

  it('changes every key when CACHE_VERSION bumps', () => {
    const a = buildHealingKey('e2e', 1, 'local', '/login', 'abc123');
    const b = buildHealingKey('e2e', 2, 'local', '/login', 'abc123');
    assert.notEqual(a, b);
  });
});
