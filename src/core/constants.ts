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

/** Redis key namespaces (prefix is applied by the RedisHelper). */
export const REDIS_NAMESPACES = {
  session: 'session',
  user: 'user',
  otp: 'otp',
  cart: 'cart',
  feature: 'feature',
} as const;

export type RedisNamespace = (typeof REDIS_NAMESPACES)[keyof typeof REDIS_NAMESPACES];
