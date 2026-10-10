/**
 * Talking to Supabase.
 *
 * Supabase is PostgreSQL with an HTTP front door (PostgREST), and that front
 * door is plain REST over JSON. Four verbs are all this product needs, so
 * this is a hundred lines of `fetch` rather than a dependency — which keeps
 * the promise the rest of Saba makes: nothing to install on the till, nothing
 * to audit, nothing to go stale.
 *
 * The key used here is the service role key. It bypasses row-level security
 * by design, which is why it lives in the till's environment and is never
 * sent to a browser, never written to the database, and never logged.
 */

import { log } from '../log.js';

export class SyncError extends Error {
  constructor(message, { status = 0, retryable = false, detail = '' } = {}) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
    /** Worth trying again later: the line was down, or the far end wobbled. */
    this.retryable = retryable;
    this.detail = detail;
  }
}

/** A connection to one project. Cheap to make; holds no socket of its own. */
export function createClient({ url, key, timeoutMs = 20000, fetchImpl = fetch }) {
  if (!url) throw new SyncError('No Supabase URL is configured');
  if (!key) throw new SyncError('No Supabase key is configured');

  const base = `${String(url).replace(/\/+$/, '')}/rest/v1`;

  async function request(method, path, { body, headers = {}, query } = {}) {
    const target = new URL(base + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) target.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetchImpl(target, {
        method,
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // No line, no DNS, or we gave up waiting. All of those are "try later",
      // never "the data was rejected".
      throw new SyncError(
        error.name === 'AbortError'
          ? 'The cloud did not answer in time'
          : 'The cloud could not be reached',
        { retryable: true, detail: error.message }
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    if (!response.ok) {
      // 5xx and 429 are the far end's problem and will pass; 4xx is ours and
      // will not, so retrying it forever would just hide a broken setup.
      const retryable = response.status >= 500 || response.status === 429;
      throw new SyncError(describe(response.status, text), {
        status: response.status,
        retryable,
        detail: text.slice(0, 500),
      });
    }

    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return {
    /** Insert or update by primary key, in one round trip. */
    upsert: (table, rows, { onConflict } = {}) => request('POST', `/${table}`, {
      body: rows,
      query: onConflict ? { on_conflict: onConflict } : undefined,
      headers: {
        prefer: 'resolution=merge-duplicates,return=minimal',
        // PostgREST otherwise returns every row it wrote, which on a month of
        // history is megabytes nobody reads.
      },
    }),

    select: (table, { columns = '*', filter = {}, order, limit } = {}) =>
      request('GET', `/${table}`, {
        query: { select: columns, order, limit, ...filter },
      }) || [],

    /** Used only to mirror the small 86 board; never on anything with money in it. */
    deleteWhere: (table, filter) => request('DELETE', `/${table}`, {
      query: filter,
      headers: { prefer: 'return=minimal' },
    }),

    /**
     * Is the project there, and does the key work?
     *
     * Asks for nothing at all from a table that must exist, which is the
     * cheapest question that still proves the URL, the key and the schema.
     */
    async check() {
      await request('GET', '/orders', { query: { select: 'id', limit: 0 } });
      return true;
    },
  };
}

function describe(status, body) {
  const hint = {
    401: 'Supabase refused the key. Check SABA_SUPABASE_KEY is the service role key.',
    403: 'Supabase refused the request. The key may be the anon key rather than the service role key.',
    404: 'Supabase has no such table. Run the migration in supabase/001_schema.sql.',
    409: 'Supabase rejected a row as a duplicate.',
    413: 'The batch was too large for Supabase to accept.',
  }[status];
  if (hint) return hint;

  let message = '';
  try { message = JSON.parse(body)?.message || ''; } catch { /* not json */ }
  return `Supabase answered ${status}${message ? `: ${message}` : ''}`;
}

/** Never log a key, even by accident. */
export const redact = (text) =>
  String(text).replace(/(eyJ[\w-]{10})[\w.-]+/g, '$1…').replace(/(apikey=)[^&\s]+/gi, '$1…');

export const logSafely = (level, message, meta = {}) =>
  log[level](message, Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, typeof v === 'string' ? redact(v) : v])
  ));
