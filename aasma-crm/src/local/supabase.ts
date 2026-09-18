import type { SyncDocument } from './sync';

/**
 * Supabase transport for the shared data.
 *
 * The browser talks to PostgREST directly — no SDK, no server — keeping one row
 * in a table that holds the whole document as jsonb. Concurrency is handled by
 * a version column: an update only lands if the version it was read at is still
 * there, which is the same guarantee the GitHub file gets from its commit sha.
 */

export interface SupabaseConfig {
  url: string;
  key: string;
  table: string;
  documentId: string;
}

export interface SupabaseSnapshot {
  document: SyncDocument | null;
  revision: string | null;
}

export class SupabaseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SupabaseError';
  }
}

/** The table this needs, ready to paste into the Supabase SQL editor. */
export const SUPABASE_SETUP_SQL = `create table if not exists crm_documents (
  id          text primary key,
  version     bigint not null default 1,
  document    jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table crm_documents enable row level security;

create policy "crm_documents read"   on crm_documents for select using (true);
create policy "crm_documents insert" on crm_documents for insert with check (true);
create policy "crm_documents update" on crm_documents for update using (true) with check (true);`;

function restUrl(config: SupabaseConfig, query = ''): string {
  const base = config.url.replace(/\/+$/, '');
  return `${base}/rest/v1/${encodeURIComponent(config.table)}${query}`;
}

function describe(status: number, body: string): SupabaseError {
  if (status === 401 || status === 403) {
    return new SupabaseError(status, 'Supabase rejected the key. Check the anon key and the table policies.');
  }
  if (status === 404 || /does not exist|PGRST205/i.test(body)) {
    return new SupabaseError(404, 'That table was not found. Run the setup SQL in Supabase first.');
  }
  if (status === 409) return new SupabaseError(409, 'Another device wrote first. Sync again.');
  return new SupabaseError(status, `Supabase returned ${status}. ${body.slice(0, 160)}`);
}

async function call(config: SupabaseConfig, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new SupabaseError(0, 'Could not reach Supabase. Check the internet connection and the project URL.');
  }
}

export async function readDocument(config: SupabaseConfig): Promise<SupabaseSnapshot> {
  const url = restUrl(config, `?id=eq.${encodeURIComponent(config.documentId)}&select=id,version,document`);
  const response = await call(config, url);
  if (!response.ok) throw describe(response.status, await response.text());

  const rows = (await response.json()) as { id: string; version: number; document: SyncDocument }[];
  if (rows.length === 0) return { document: null, revision: null };

  const row = rows[0];
  if (!row.document || typeof row.document !== 'object') {
    throw new SupabaseError(422, 'That row does not hold Aasma Buildcon CRM data.');
  }
  return { document: row.document, revision: String(row.version) };
}

export async function writeDocument(
  config: SupabaseConfig,
  document: SyncDocument,
  revision: string | null,
  device: string,
): Promise<string> {
  // No row yet: insert one. A duplicate key here means another device created it
  // between the read and the write, which the caller retries.
  if (!revision) {
    const response = await call(config, restUrl(config), {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ id: config.documentId, version: 1, document, updated_by: device }]),
    });
    if (response.status === 409) throw new SupabaseError(409, 'Another device created the record first. Sync again.');
    if (!response.ok) throw describe(response.status, await response.text());
    return '1';
  }

  const next = Number(revision) + 1;
  const url = restUrl(
    config,
    `?id=eq.${encodeURIComponent(config.documentId)}&version=eq.${encodeURIComponent(revision)}`,
  );
  const response = await call(config, url, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ version: next, document, updated_by: device, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw describe(response.status, await response.text());

  // PostgREST returns the rows it changed; none means the version moved on.
  const rows = (await response.json()) as unknown[];
  if (rows.length === 0) {
    throw new SupabaseError(409, 'Another device wrote first. Sync again.');
  }
  return String(next);
}

/** Confirms the project, key and table are usable before the settings are saved. */
export async function probe(config: SupabaseConfig): Promise<{ exists: boolean }> {
  const response = await call(config, restUrl(config, '?select=id&limit=1'));
  if (!response.ok) throw describe(response.status, await response.text());
  const snapshot = await readDocument(config);
  return { exists: Boolean(snapshot.document) };
}
