import { API_ROUTES } from '../core/constants.js';
import { createLogger } from '../core/logger.js';
import type { ApiClient, ApiResponse } from './api-client.js';
import type { AuthTokens, Credentials, UserProfile } from './types.js';

const log = createLogger('api:auth');

/** Auth-related endpoints. Composed by flows that need a programmatic login. */
export class AuthApi {
  constructor(private readonly client: ApiClient) {}

  /** POST /auth/login */
  login(credentials: Credentials): Promise<ApiResponse<AuthTokens>> {
    log.debug(`login as ${credentials.username}`);
    return this.client.post<AuthTokens>(API_ROUTES.login, credentials);
  }

  /** POST /auth/logout */
  logout(): Promise<ApiResponse<null>> {
    return this.client.post<null>(API_ROUTES.logout);
  }

  /** GET /users/me using a bearer token. */
  me(token: string): Promise<ApiResponse<UserProfile>> {
    return this.client.withAuth(token).get<UserProfile>(API_ROUTES.profile);
  }

  /**
   * Logs in and returns only the access token, throwing on failure.
   * This is what most flows should call.
   */
  async loginAndGetToken(credentials: Credentials): Promise<string> {
    const response = await this.login(credentials);
    if (!response.ok || !response.body?.accessToken) {
      throw new Error(`Login failed for "${credentials.username}" (status ${response.status})`);
    }
    return response.body.accessToken;
  }
}
