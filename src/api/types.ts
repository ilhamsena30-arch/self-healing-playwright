/**
 * Data transfer objects shared by the API layer and the UI flows.
 * Keep these as plain types — they are the contract between the two layers.
 */

export interface Credentials {
  username: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  inStock: boolean;
}

export interface CreateItemPayload {
  name: string;
  description?: string;
  price: number;
  currency?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
