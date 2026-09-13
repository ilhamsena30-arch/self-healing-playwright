import { API_ROUTES } from '../core/constants.js';
import type { ApiClient, ApiResponse } from './api-client.js';
import type { CatalogItem, CreateItemPayload, Paginated } from './types.js';

/** Item/catalog endpoints — a representative CRUD resource for the boilerplate. */
export class ItemsApi {
  constructor(private readonly client: ApiClient) {}

  list(
    params: { page?: number; pageSize?: number; search?: string } = {},
  ): Promise<ApiResponse<Paginated<CatalogItem>>> {
    return this.client.get<Paginated<CatalogItem>>(API_ROUTES.items, { params });
  }

  getById(id: string): Promise<ApiResponse<CatalogItem>> {
    return this.client.get<CatalogItem>(`${API_ROUTES.items}/${id}`);
  }

  create(payload: CreateItemPayload): Promise<ApiResponse<CatalogItem>> {
    return this.client.post<CatalogItem>(API_ROUTES.items, payload);
  }

  update(id: string, payload: Partial<CreateItemPayload>): Promise<ApiResponse<CatalogItem>> {
    return this.client.patch<CatalogItem>(`${API_ROUTES.items}/${id}`, payload);
  }

  remove(id: string): Promise<ApiResponse<null>> {
    return this.client.delete<null>(`${API_ROUTES.items}/${id}`);
  }

  /** Convenience: create and return the created item, throwing on failure. */
  async createOrThrow(payload: CreateItemPayload): Promise<CatalogItem> {
    const response = await this.create(payload);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to create item (status ${response.status})`);
    }
    return response.body;
  }
}
