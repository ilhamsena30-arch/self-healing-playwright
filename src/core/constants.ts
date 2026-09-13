/** Framework-wide constants. Keep magic strings/numbers here. */

export const ROUTES = {
  home: '/',
  login: '/login',
  dashboard: '/dashboard',
  profile: '/profile',
} as const;

export const API_ROUTES = {
  login: '/auth/login',
  logout: '/auth/logout',
  profile: '/users/me',
  items: '/items',
} as const;

export const TIMEOUTS = {
  short: 5_000,
  medium: 15_000,
  long: 30_000,
} as const;

/** Self-healing runtime tuning. */
export const SELF_HEALING = {
  /** Fast-fail timeout applied to each healing attempt (Tier 1-3). */
  attemptTimeoutMs: 2_500,
  /** Redis hash holding `failed selector -> healed selector` mappings. */
  redisKey: 'healed_locators',
  /** Local run log produced by the report writer. */
  reportFile: 'self-healing-report.json',
  /** Interactive methods that are intercepted for healing. */
  interactiveMethods: ['click', 'fill', 'type', 'selectOption'] as const,
} as const;

/** Redis key namespaces (prefix is applied by the RedisHelper). */
export const REDIS_NAMESPACES = {
  session: 'session',
  user: 'user',
  otp: 'otp',
  cart: 'cart',
  feature: 'feature',
} as const;

export type RedisNamespace = (typeof REDIS_NAMESPACES)[keyof typeof REDIS_NAMESPACES];
