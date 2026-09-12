import type { APIRequestContext, APIResponse } from '@playwright/test';
import { env } from '../core/env.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('api:client');

export interface RequestOptions {
  /** Query string parameters. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Extra headers merged with the client defaults. */
  headers?: Record<string, string>;
  /** Override the client's timeout (ms). */
  timeout?: number;
}

export interface ApiResponse<T> {
  status: number;
  ok: boolean;
  body: T;
  headers: Record<string, string>;
  raw: APIResponse;
}

/**
 * Small typed wrapper around Playwright's `APIRequestContext`.
 *
 * Inherits the browser context's cookies when constructed with
 * `context.request`, which means API calls and UI share the same session.
 */
export class ApiClient {
  constructor(
    public readonly request: APIRequestContext,
    public readonly baseUrl: string = env.apiBaseUrl,
    public readonly defaultHeaders: Record<string, string> = {},
  ) {}

  // ---------------------------------------------------------------------------
  // Verb helpers
  // ---------------------------------------------------------------------------

  get<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.send<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.send<T>('POST', path, options, body);
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.send<T>('PUT', path, options, body);
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.send<T>('PATCH', path, options, body);
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.send<T>('DELETE', path, options);
  }

  // ---------------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------------

  private async send<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: RequestOptions,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path, options.params);
    const started = Date.now();
    log.debug(`${method} ${url}`);

    const response = await this.request.fetch(url, {
      method,
      headers: { Accept: 'application/json', ...this.defaultHeaders, ...options.headers },
      data: body,
      timeout: options.timeout ?? env.timeoutMs,
    });

    const duration = Date.now() - started;
    const parsed = await this.parse<T>(response);

    log.debug(`${method} ${url} -> ${response.status()} (${duration}ms)`);

    return {
      status: response.status(),
      ok: response.ok(),
      body: parsed,
      headers: response.headers(),
      raw: response,
    };
  }

  private buildUrl(path: string, params?: RequestOptions['params']): string {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async parse<T>(response: APIResponse): Promise<T> {
    const contentType = response.headers()['content-type'] ?? '';
    if (contentType.includes('application/json')) {
      try {
        return (await response.json()) as T;
      } catch {
        return null as unknown as T;
      }
    }
    return (await response.text()) as unknown as T;
  }

  // ---------------------------------------------------------------------------
  // Convenience wrappers
  // ---------------------------------------------------------------------------

  /** Throws a descriptive error when the response is not 2xx. */
  async expectOk<T>(promise: Promise<ApiResponse<T>>): Promise<ApiResponse<T>> {
    const response = await promise;
    if (!response.ok) {
      throw new Error(
        `Expected a 2xx response but received ${response.status}. Body: ${JSON.stringify(response.body).slice(0, 500)}`,
      );
    }
    return response;
  }

  /** Returns a new client that attaches `Authorization: Bearer <token>`. */
  withAuth(token: string): ApiClient {
    return new ApiClient(this.request, this.baseUrl, {
      ...this.defaultHeaders,
      Authorization: `Bearer ${token}`,
    });
  }

  /** Returns a new client with extra default headers. */
  withHeaders(headers: Record<string, string>): ApiClient {
    return new ApiClient(this.request, this.baseUrl, { ...this.defaultHeaders, ...headers });
  }
}
