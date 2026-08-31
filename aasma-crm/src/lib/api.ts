import type { Paginated } from '@shared/types';

/**
 * Thin wrapper over fetch for the local API.
 *
 * Everything goes through here so the token, JSON handling and the "your
 * session expired" path exist in exactly one place.
 */

const TOKEN_KEY = 'aasma.token';

/**
 * Built for GitHub Pages (or any static host) the app has no server to talk to,
 * so requests are answered by the browser database in src/local instead. The
 * desktop build leaves this off and uses the Express API over fetch.
 */
export const LOCAL_MODE = import.meta.env.VITE_LOCAL === '1';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private-mode browsers block storage; the session simply will not persist.
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(params?: Query): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** FormData for uploads; sent as-is without a JSON content type. */
  form?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();

  if (LOCAL_MODE) {
    // Loaded on demand so the desktop bundle never carries the browser database.
    const { localRequest } = await import('@/local');
    try {
      return await localRequest<T>({
        method: options.method ?? 'GET',
        path,
        query: (options.query ?? {}) as Record<string, string | number | boolean>,
        body: options.body,
        form: options.form,
        token,
      });
    } catch (error) {
      const failure = error as { status?: number; message?: string };
      if (failure.status === 401) {
        setToken(null);
        onUnauthorized?.();
      }
      throw new ApiError(failure.status ?? 500, failure.message ?? 'Something went wrong.');
    }
  }

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!options.form && options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`/api${path}${buildQuery(options.query)}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'Cannot reach the local service. Is the application still running?');
  }

  if (response.status === 401) {
    setToken(null);
    onUnauthorized?.();
  }

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    let details: { path: string; message: string }[] | undefined;
    try {
      const payload = (await response.json()) as { error?: string; details?: { path: string; message: string }[] };
      if (payload.error) message = payload.error;
      details = payload.details;
    } catch {
      // A non-JSON error body (a crash page, say) keeps the generic message.
    }
    throw new ApiError(response.status, message, details);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }),
  list: <T>(path: string, query?: Query, signal?: AbortSignal) => request<Paginated<T>>(path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
};

/**
 * Triggers a file download through the browser. Electron shows its normal save
 * dialog, so exports land wherever the user chooses.
 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadFile(path: string, query?: Query): Promise<void> {
  const token = getToken();

  if (LOCAL_MODE) {
    const { localDownload } = await import('@/local');
    try {
      const file = await localDownload(path, (query ?? {}) as Record<string, string | number | boolean>, token);
      saveBlob(file.blob, file.filename);
      return;
    } catch (error) {
      const failure = error as { status?: number; message?: string };
      throw new ApiError(failure.status ?? 500, failure.message ?? 'The export could not be generated.');
    }
  }

  const response = await fetch(`/api${path}${buildQuery(query)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'The export could not be generated.');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  saveBlob(await response.blob(), match?.[1] ?? 'export.xlsx');
}
