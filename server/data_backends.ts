import logger from '../src/shared/utils/logger';

import DataBackend from '../src/shared/data_backend';

const DEFAULT_COLLECTION = 'vimflowy_data';

type DirectusResponse<T> = {
  data: T;
};

type DirectusDataRow = {
  id: number;
  user_id: string;
  key: string;
  value: string;
};

function encodeFilterParam(value: string): string {
  return encodeURIComponent(value);
}

export class DirectusBackend extends DataBackend {
  private readonly userId: string;
  private readonly directusUrl: string;
  private readonly token: string;
  private readonly collection: string;
  private keyToItemId: { [key: string]: number } = {};

  constructor(userId: string, directusUrl: string, token: string, collection = DEFAULT_COLLECTION) {
    super();
    this.userId = userId;
    this.directusUrl = directusUrl.replace(/\/+$/, '');
    this.token = token;
    this.collection = collection;
  }

  private async request<T>(path: string, method: string = 'GET', body: Object | null = null): Promise<T> {
    const response = await fetch(`${this.directusUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Directus request failed (${response.status} ${method} ${path}): ${text}`);
    }
    if (response.status === 204) {
      return null as unknown as T;
    }
    return await response.json() as T;
  }

  public async get(key: string): Promise<string | null> {
    const query = `/items/${this.collection}` +
      `?filter[user_id][_eq]=${encodeFilterParam(this.userId)}` +
      `&filter[key][_eq]=${encodeFilterParam(key)}` +
      '&limit=1';
    const response = await this.request<DirectusResponse<Array<DirectusDataRow>>>(query);
    const row = response.data && response.data[0];
    if (!row) {
      return null;
    }
    this.keyToItemId[key] = row.id;
    return row.value;
  }

  public async set(key: string, value: string): Promise<void> {
    await this.setMany([{ key, value }]);
  }

  public async setMany(entries: Array<{ key: string, value: string }>): Promise<void> {
    for (const entry of entries) {
      const existingId = this.keyToItemId[entry.key];
      if (existingId) {
        await this.request(`/items/${this.collection}/${existingId}`, 'PATCH', {
          value: entry.value,
        });
        continue;
      }

      const query = `/items/${this.collection}` +
        `?filter[user_id][_eq]=${encodeFilterParam(this.userId)}` +
        `&filter[key][_eq]=${encodeFilterParam(entry.key)}` +
        '&limit=1';
      const existing = await this.request<DirectusResponse<Array<DirectusDataRow>>>(query);
      if (existing.data && existing.data.length > 0) {
        const row = existing.data[0];
        this.keyToItemId[entry.key] = row.id;
        await this.request(`/items/${this.collection}/${row.id}`, 'PATCH', { value: entry.value });
        continue;
      }

      const created = await this.request<DirectusResponse<DirectusDataRow>>(`/items/${this.collection}`, 'POST', {
        user_id: this.userId,
        key: entry.key,
        value: entry.value,
      });
      if (created && created.data && created.data.id) {
        this.keyToItemId[entry.key] = created.data.id;
      }
    }
  }

  public async ping(): Promise<void> {
    await this.request('/server/ping');
    logger.info('Connected to Directus backend.');
  }

  public async listDocumentNames(): Promise<string[]> {
    const query = `/items/${this.collection}` +
      `?filter[user_id][_eq]=${encodeFilterParam(this.userId)}` +
      `&filter[key][_ends_with]=save%3AlastID` +
      `&fields[]=key&limit=1000`;
    const response = await this.request<DirectusResponse<Array<{key: string}>>>(query);
    return (response.data || []).map(row => {
      // key is like `${docname}save:lastID` → strip suffix
      return row.key.replace(/save:lastID$/, '');
    });
  }
}
