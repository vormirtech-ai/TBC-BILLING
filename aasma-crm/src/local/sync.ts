import { db, flush, newUid, nextId, reviveDates, save } from './db';
import { RELATIONS, SYNCED_TABLES, type Database, type SyncMetaRow, type TableName, type TombstoneRow } from './types';

/**
 * Sharing data through a GitHub repository.
 *
 * Each computer keeps its own copy of everything and works offline; syncing
 * exchanges that copy with one JSON file in a repository, so the administrator
 * and the site users end up with the same records. There is no server in the
 * middle — the browser talks to the GitHub API directly with a token the user
 * supplies, and that token never leaves the machine it was entered on.
 *
 * Merging is per record rather than per file, so two people working at the same
 * time do not overwrite each other:
 *   - every row carries a uid, which is what both sides agree identifies it;
 *   - the copy with the later timestamp wins;
 *   - deletions are remembered as tombstones so a row is not resurrected;
 *   - numeric ids stay local, and foreign keys on incoming rows are repointed
 *     at the local ids of the same records.
 */

const API = 'https://api.github.com';
const DOC_FORMAT = 'aasma-crm-sync';
/** Parents before children, so a foreign key can always be resolved. */
const MERGE_ORDER: TableName[] = [
  'users',
  'projects',
  'projectStages',
  'stageProgressLogs',
  'milestones',
  'clients',
  'properties',
  'leads',
  'leadActivities',
  'bookings',
  'payments',
  'documents',
  'interactions',
  'materials',
  'purchases',
  'materialUsages',
  'stockAdjustments',
  'workers',
  'attendances',
  'dprs',
  'dprMaterials',
  'dprPhotos',
  'forecastSnapshots',
];

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;

export interface SyncDocument {
  format: string;
  version: number;
  updatedAt: string;
  device: string;
  tables: Partial<Record<TableName, Record<string, unknown>[]>>;
  tombstones: { uid: string; table: TableName; deletedAt: string }[];
}

export interface SyncSettings {
  deviceName: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
  autoSync: boolean;
  includePhotos: boolean;
}

export class SyncError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

interface StoredMeta extends SyncMetaRow {
  includePhotos?: boolean;
  /**
   * True while this browser still holds nothing but the first-run sample data.
   * Joining a repository that already has real records then replaces the sample
   * rather than merging two sets of demo records together.
   */
  demoData?: boolean;
}

export function syncMeta(): StoredMeta {
  const data = db();
  let row = data.syncMeta.find((item) => item.key === 'sync') as StoredMeta | undefined;
  if (!row) {
    row = {
      key: 'sync',
      deviceId: newUid(),
      deviceName: '',
      owner: '',
      repo: '',
      branch: 'main',
      path: 'crm-data.json',
      token: '',
      autoSync: true,
      includePhotos: false,
      demoData: false,
      lastSyncedAt: null,
      lastPushedAt: null,
      lastStatus: 'Not connected yet.',
      remoteSha: null,
    };
    data.syncMeta.push(row);
    save('syncMeta');
  }
  return row;
}

export function saveSyncMeta(patch: Partial<StoredMeta>): StoredMeta {
  const row = syncMeta();
  Object.assign(row, patch);
  save('syncMeta');
  return row;
}

/** What the Settings screen shows; the token is never sent back to the page. */
export function syncStatus(): Record<string, unknown> {
  const meta = syncMeta();
  return {
    configured: Boolean(meta.owner && meta.repo && meta.token),
    deviceId: meta.deviceId,
    deviceName: meta.deviceName,
    owner: meta.owner,
    repo: meta.repo,
    branch: meta.branch,
    path: meta.path,
    autoSync: meta.autoSync,
    includePhotos: meta.includePhotos ?? false,
    hasToken: Boolean(meta.token),
    lastSyncedAt: meta.lastSyncedAt,
    lastPushedAt: meta.lastPushedAt,
    lastStatus: meta.lastStatus,
    remoteSha: meta.remoteSha,
  };
}

// ------------------------------------------------------------------ transport

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function contentsUrl(meta: StoredMeta): string {
  const path = meta.path.split('/').map(encodeURIComponent).join('/');
  return `${API}/repos/${encodeURIComponent(meta.owner)}/${encodeURIComponent(meta.repo)}/contents/${path}`;
}

function describeFailure(status: number, body: string): SyncError {
  if (status === 401) return new SyncError(401, 'GitHub rejected the token. Check it has not expired.');
  if (status === 403) {
    return new SyncError(403, 'GitHub refused the request. The token needs Contents read and write on this repository.');
  }
  if (status === 404) {
    return new SyncError(404, 'That repository or branch could not be found with this token.');
  }
  if (status === 409 || status === 422) {
    return new SyncError(status, 'The file changed on GitHub while this device was writing. Sync again.');
  }
  return new SyncError(status, `GitHub returned ${status}. ${body.slice(0, 160)}`);
}

async function request(meta: StoredMeta, url: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  const { accept, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        Authorization: `Bearer ${meta.token}`,
        Accept: accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...(rest.headers ?? {}),
      },
    });
  } catch {
    throw new SyncError(0, 'Could not reach GitHub. Check the internet connection and try again.');
  }
  return response;
}

/** Reads the shared file. A missing file simply means nothing has synced yet. */
export async function fetchRemote(
  meta: StoredMeta,
): Promise<{ document: SyncDocument | null; sha: string | null }> {
  const url = `${contentsUrl(meta)}?ref=${encodeURIComponent(meta.branch)}`;
  const response = await request(meta, url);

  if (response.status === 404) return { document: null, sha: null };
  if (!response.ok) throw describeFailure(response.status, await response.text());

  const payload = (await response.json()) as { sha: string; content?: string; encoding?: string; size?: number };
  let text: string;
  if (payload.content && payload.encoding === 'base64') {
    text = decodeBase64(payload.content);
  } else {
    // Files over a megabyte come back without inline content; ask for the raw body.
    const raw = await request(meta, url, { accept: 'application/vnd.github.raw' });
    if (!raw.ok) throw describeFailure(raw.status, await raw.text());
    text = await raw.text();
  }

  try {
    const document = JSON.parse(text) as SyncDocument;
    if (document.format !== DOC_FORMAT) {
      throw new SyncError(422, 'That file is not an Aasma Buildcon CRM sync file.');
    }
    return { document, sha: payload.sha };
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError(422, 'The file on GitHub could not be read as sync data.');
  }
}

async function writeRemote(meta: StoredMeta, document: SyncDocument, sha: string | null): Promise<string> {
  const body = JSON.stringify(document, null, 0);
  if (body.length > MAX_DOCUMENT_BYTES) {
    throw new SyncError(
      413,
      'The data file is too large to send to GitHub. Turn off photo syncing, or remove old site photos.',
    );
  }

  const response = await request(meta, contentsUrl(meta), {
    method: 'PUT',
    body: JSON.stringify({
      message: `CRM sync from ${meta.deviceName || 'a device'} — ${new Date().toISOString()}`,
      content: encodeBase64(body),
      branch: meta.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!response.ok) throw describeFailure(response.status, await response.text());
  const payload = (await response.json()) as { content?: { sha?: string } };
  return payload.content?.sha ?? '';
}

// ------------------------------------------------------------------ merging

type Row = Record<string, unknown> & { id: number; uid: string };

function stamp(row: Record<string, unknown>): number {
  const value = (row.updatedAt ?? row.createdAt) as Date | string | undefined;
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/** Builds the document this device would publish. */
export function buildDocument(includePhotos: boolean): SyncDocument {
  const data = db();
  const meta = syncMeta();
  const tables: SyncDocument['tables'] = {};

  for (const table of SYNCED_TABLES) {
    if (table === 'dprPhotos' && !includePhotos) continue;
    tables[table] = data[table] as unknown as Record<string, unknown>[];
  }

  return {
    format: DOC_FORMAT,
    version: 1,
    updatedAt: new Date().toISOString(),
    device: meta.deviceName || meta.deviceId,
    tables,
    tombstones: data.tombstones.map((row) => ({
      uid: row.uid,
      table: row.table,
      deletedAt: row.deletedAt.toISOString(),
    })),
  };
}

export interface MergeReport {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

/**
 * Folds a document from GitHub into this device's data. Local rows the remote
 * has not seen are left alone — the next push carries them across.
 */
export function mergeDocument(document: SyncDocument): MergeReport {
  const data = db();
  const report: MergeReport = { added: 0, updated: 0, removed: 0, skipped: 0 };
  const touched = new Set<TableName>();

  const remote = reviveDates(document.tables) as Partial<Record<TableName, Row[]>>;

  // Deletions from both sides, newest wins.
  const deletions = new Map<string, number>();
  for (const row of data.tombstones) deletions.set(row.uid, row.deletedAt.getTime());
  const incomingTombstones: TombstoneRow[] = [];
  for (const row of document.tombstones ?? []) {
    const at = new Date(row.deletedAt).getTime();
    if (Number.isNaN(at)) continue;
    if (!deletions.has(row.uid) || (deletions.get(row.uid) ?? 0) < at) {
      deletions.set(row.uid, at);
      incomingTombstones.push({ uid: row.uid, table: row.table, deletedAt: new Date(at) });
    }
  }

  // uid → local numeric id, filled in as tables are merged so that children can
  // resolve their parents.
  const localIdByUid = new Map<string, Map<string, number>>();
  for (const table of MERGE_ORDER) {
    const map = new Map<string, number>();
    for (const row of data[table] as unknown as Row[]) {
      if (row.uid) map.set(row.uid, row.id);
    }
    localIdByUid.set(table, map);
  }

  // The remote's own numeric ids, so its foreign keys can be translated.
  const remoteUidById = new Map<string, Map<number, string>>();
  for (const table of MERGE_ORDER) {
    const map = new Map<number, string>();
    for (const row of remote[table] ?? []) {
      if (row.uid) map.set(row.id, row.uid);
    }
    remoteUidById.set(table, map);
  }

  const resolve = (table: TableName, field: string, value: unknown): { ok: boolean; value: number | null } => {
    if (value === null || value === undefined) return { ok: true, value: null };
    const relations = RELATIONS[table];
    const target = relations?.[field];
    if (!target) return { ok: true, value: value as number };
    const uid = remoteUidById.get(target)?.get(Number(value));
    if (!uid) return { ok: false, value: null };
    const localId = localIdByUid.get(target)?.get(uid);
    if (localId === undefined) return { ok: false, value: null };
    return { ok: true, value: localId };
  };

  for (const table of MERGE_ORDER) {
    const incoming = remote[table];
    if (!incoming) continue;
    const rows = data[table] as unknown as Row[];
    const byUid = new Map(rows.filter((row) => row.uid).map((row) => [row.uid, row]));

    for (const source of incoming) {
      if (!source?.uid) continue;

      const deletedAt = deletions.get(source.uid);
      if (deletedAt !== undefined && deletedAt >= stamp(source)) continue;

      // Translate the foreign keys before anything is written.
      const candidate: Record<string, unknown> = { ...source };
      let resolvable = true;
      for (const field of Object.keys(RELATIONS[table] ?? {})) {
        const outcome = resolve(table, field, source[field]);
        if (!outcome.ok) {
          // The parent is missing here — usually because it was deleted on this
          // device. Nullable links are dropped, required ones skip the row.
          if (source[field] === null || source[field] === undefined) continue;
          resolvable = false;
          break;
        }
        candidate[field] = outcome.value;
      }
      if (!resolvable) {
        report.skipped += 1;
        continue;
      }

      const existing = byUid.get(source.uid);
      if (existing) {
        if (stamp(source) > stamp(existing)) {
          const id = existing.id;
          Object.assign(existing, candidate, { id });
          report.updated += 1;
          touched.add(table);
        }
      } else {
        const id = nextId(rows as unknown as { id: number }[]);
        const row = { ...candidate, id } as Row;
        rows.push(row);
        byUid.set(row.uid, row);
        localIdByUid.get(table)?.set(row.uid, id);
        report.added += 1;
        touched.add(table);
      }
    }
  }

  // Apply deletions that arrived from the other device.
  for (const table of MERGE_ORDER) {
    const rows = data[table] as unknown as Row[];
    const keep = rows.filter((row) => {
      const deletedAt = row.uid ? deletions.get(row.uid) : undefined;
      return !(deletedAt !== undefined && deletedAt >= stamp(row));
    });
    if (keep.length !== rows.length) {
      report.removed += rows.length - keep.length;
      (data as unknown as Record<string, unknown[]>)[table] = keep;
      touched.add(table);
    }
  }

  // Company settings: whichever side saved last.
  for (const row of (reviveDates(remote.settings ?? []) as unknown as { key: string; value: string; updatedAt: Date }[]) ??
    []) {
    const existing = data.settings.find((item) => item.key === row.key);
    if (!existing) {
      data.settings.push(row);
      touched.add('settings');
    } else if (new Date(row.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
      existing.value = row.value;
      existing.updatedAt = new Date(row.updatedAt);
      touched.add('settings');
    }
  }

  if (incomingTombstones.length > 0) {
    for (const row of incomingTombstones) {
      data.tombstones = data.tombstones.filter((item) => item.uid !== row.uid);
      data.tombstones.push(row);
    }
    touched.add('tombstones');
  }

  if (touched.size > 0) save(...touched);
  return report;
}

/** Does the document from GitHub actually carry records? */
function hasContent(document: SyncDocument): boolean {
  return SYNCED_TABLES.some((table) => (document.tables[table]?.length ?? 0) > 0);
}

/**
 * Clears the first-run sample data so the records from GitHub stand on their
 * own. The sign-in accounts go too — this device now uses the shared ones — so
 * the person is asked to sign in again afterwards.
 */
function dropSampleData(): void {
  const data = db();
  for (const table of SYNCED_TABLES) {
    (data as unknown as Record<string, unknown[]>)[table] = [];
  }
  data.tombstones = [];
  data.sessions = [];
  saveSyncMeta({ demoData: false });
  save(...SYNCED_TABLES, 'tombstones', 'sessions');
}

// ------------------------------------------------------------------ actions

function requireConfigured(): StoredMeta {
  const meta = syncMeta();
  if (!meta.owner || !meta.repo || !meta.token) {
    throw new SyncError(400, 'Add the repository and a GitHub token in Settings → Sync first.');
  }
  return meta;
}

export async function pull(): Promise<MergeReport & { found: boolean; signOutRequired: boolean }> {
  const meta = requireConfigured();
  const { document, sha } = await fetchRemote(meta);
  if (!document) {
    saveSyncMeta({ lastStatus: 'Nothing on GitHub yet — push to create the shared file.', remoteSha: null });
    await flush();
    return { added: 0, updated: 0, removed: 0, skipped: 0, found: false, signOutRequired: false };
  }

  const replacing = Boolean(meta.demoData) && hasContent(document);
  if (replacing) dropSampleData();

  const report = mergeDocument(document);
  saveSyncMeta({
    remoteSha: sha,
    lastSyncedAt: new Date(),
    lastStatus: replacing
      ? 'Sample data replaced with the records from GitHub.'
      : `Pulled ${report.added} new and ${report.updated} updated record(s).`,
  });
  await flush();
  return { ...report, found: true, signOutRequired: replacing };
}

export async function push(): Promise<{ sha: string }> {
  const meta = requireConfigured();
  const { document, sha } = await fetchRemote(meta);
  // Fold in anything that landed on GitHub since the last exchange, so a push
  // never discards someone else's work.
  if (document) mergeDocument(document);

  const outgoing = buildDocument(meta.includePhotos ?? false);
  const newSha = await writeRemote(meta, outgoing, sha);
  saveSyncMeta({
    remoteSha: newSha,
    lastPushedAt: new Date(),
    lastSyncedAt: new Date(),
    // Once this device's data is the shared data, it is no longer "just a sample".
    demoData: false,
    lastStatus: 'This device is up to date with GitHub.',
  });
  await flush();
  return { sha: newSha };
}

/** Pull, merge, then push — what the Sync button does. */
export async function syncNow(): Promise<MergeReport & { pushed: boolean; signOutRequired: boolean }> {
  const meta = requireConfigured();
  const { document, sha } = await fetchRemote(meta);

  const replacing = Boolean(meta.demoData) && Boolean(document) && hasContent(document!);
  if (replacing) dropSampleData();

  const report = document ? mergeDocument(document) : { added: 0, updated: 0, removed: 0, skipped: 0 };

  const outgoing = buildDocument(meta.includePhotos ?? false);
  let newSha: string;
  try {
    newSha = await writeRemote(meta, outgoing, sha);
  } catch (error) {
    // Someone wrote between the read and the write; take their version and retry once.
    if (error instanceof SyncError && (error.status === 409 || error.status === 422)) {
      const retry = await fetchRemote(meta);
      if (retry.document) mergeDocument(retry.document);
      newSha = await writeRemote(meta, buildDocument(meta.includePhotos ?? false), retry.sha);
    } else {
      throw error;
    }
  }

  saveSyncMeta({
    remoteSha: newSha,
    lastSyncedAt: new Date(),
    lastPushedAt: new Date(),
    demoData: false,
    lastStatus: replacing
      ? 'Sample data replaced with the records from GitHub.'
      : `Synced — ${report.added} added, ${report.updated} updated, ${report.removed} removed.`,
  });
  await flush();
  return { ...report, pushed: true, signOutRequired: replacing };
}

/** Checks the repository is reachable and writable before saving the settings. */
export async function testConnection(settings: SyncSettings): Promise<{ ok: true; exists: boolean }> {
  const probe: StoredMeta = { ...syncMeta(), ...settings };
  const response = await request(
    probe,
    `${API}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`,
  );
  if (!response.ok) throw describeFailure(response.status, await response.text());

  const repository = (await response.json()) as { permissions?: { push?: boolean } };
  if (repository.permissions && !repository.permissions.push) {
    throw new SyncError(403, 'This token can read the repository but not write to it.');
  }

  const remote = await fetchRemote(probe);
  return { ok: true, exists: Boolean(remote.document) };
}

export type { StoredMeta as SyncMetaState };
export type { Database as SyncDatabase };
