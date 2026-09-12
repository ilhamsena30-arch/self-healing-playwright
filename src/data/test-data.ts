import type { CatalogItem, CreateItemPayload } from '../api/types.js';

/**
 * Central test data factory. Import from specs instead of hardcoding values.
 * Everything here targets the placeholder site, so replace when you wire a real app.
 */

let counter = 0;

/** Generates a value unique per test run, e.g. `item-1726a1b-7`. */
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export const users = {
  /** The account used for happy-path specs. Mirrors `.env` placeholders. */
  standard: {
    username: process.env.TEST_USERNAME ?? 'tester@example.com',
    password: process.env.TEST_PASSWORD ?? 'SuperSecret123!',
  },
  /** An account that is intentionally invalid, for negative tests. */
  invalid: {
    username: 'nobody@example.com',
    password: 'wrong-password',
  },
  /** A locked account, for account-lockout scenarios. */
  locked: {
    username: 'locked@example.com',
    password: 'SuperSecret123!',
  },
} as const;

/** Builds a valid item payload with a unique name unless one is supplied. */
export function buildItemPayload(overrides: Partial<CreateItemPayload> = {}): CreateItemPayload {
  return {
    name: unique('item'),
    description: 'Created by the automated test suite',
    price: 19.99,
    currency: 'USD',
    ...overrides,
  };
}

/** A deterministic item used when a test just needs something present. */
export const sampleItem: CreateItemPayload = {
  name: 'sample-item',
  description: 'Deterministic fixture item',
  price: 9.5,
  currency: 'USD',
};

/** A fully-formed catalog item, useful for stubbing API responses. */
export const sampleCatalogItem: CatalogItem = {
  id: 'item-0001',
  name: sampleItem.name,
  description: sampleItem.description ?? '',
  price: sampleItem.price,
  currency: 'USD',
  inStock: true,
};

/** Invalid login combinations, keyed by scenario. */
export const invalidCredentials = [
  { label: 'unknown user', credentials: { username: 'ghost@example.com', password: 'whatever' } },
  { label: 'wrong password', credentials: { username: users.standard.username, password: 'nope' } },
  { label: 'empty values', credentials: { username: '', password: '' } },
] as const;
