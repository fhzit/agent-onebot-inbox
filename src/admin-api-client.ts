export type AdminApiClientOptions = {
  baseUrl: string | URL;
  token?: string;
  fetcher?: typeof fetch;
};

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/** Small authenticated client for operator scripts talking to the admin API. */
export class AdminApiClient {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: AdminApiClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch;
  }

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(path.replace(/^\/+/, ''), this.baseUrl.href.endsWith('/') ? this.baseUrl : `${this.baseUrl.href}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await this.fetcher(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : null; } catch {
      throw new AdminApiError(`Admin API returned invalid JSON (${response.status})`, response.status);
    }
    if (!response.ok) {
      const error = parsed && typeof parsed === 'object' ? (parsed as { error?: { code?: unknown; message?: unknown } }).error : undefined;
      throw new AdminApiError(typeof error?.message === 'string' ? error.message : `Admin API request failed (${response.status})`, response.status, typeof error?.code === 'string' ? error.code : undefined);
    }
    return parsed as T;
  }
}
