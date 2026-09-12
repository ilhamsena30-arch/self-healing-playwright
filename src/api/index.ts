import type { APIRequestContext } from '@playwright/test';
import { ApiClient } from './api-client.js';
import { AuthApi } from './auth.api.js';
import { ItemsApi } from './items.api.js';
import { env } from '../core/env.js';

/**
 * Aggregates every endpoint service behind one object, so flows can use:
 *
 *   const token = await api.auth.loginAndGetToken(creds);
 *   await api.items.list();
 *
 * Passing the browser context's `request` makes API calls share the UI session.
 */
export class ApiFactory {
  readonly client: ApiClient;
  readonly auth: AuthApi;
  readonly items: ItemsApi;

  constructor(
    request: APIRequestContext,
    baseUrl: string = env.apiBaseUrl,
    defaultHeaders: Record<string, string> = {},
  ) {
    this.client = new ApiClient(request, baseUrl, defaultHeaders);
    this.auth = new AuthApi(this.client);
    this.items = new ItemsApi(this.client);
  }

  /** Returns a factory whose requests all carry the bearer token. */
  authenticated(token: string): ApiFactory {
    return new ApiFactory(this.client.request, this.client.baseUrl, {
      ...this.client.defaultHeaders,
      Authorization: `Bearer ${token}`,
    });
  }
}

export { ApiClient } from './api-client.js';
export type { ApiResponse, RequestOptions } from './api-client.js';
export { AuthApi } from './auth.api.js';
export { ItemsApi } from './items.api.js';
export * from './types.js';
