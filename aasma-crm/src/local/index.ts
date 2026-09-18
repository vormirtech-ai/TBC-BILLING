import { db, flush, loadDatabase, save } from './db';
import { ensureAdminUser } from './auth';
import { buildDemoData } from './seed';
import { saveSyncMeta, syncMeta } from './sync';
import { describeError, handlers, readSettings, type Context } from './handlers';
import { userForToken } from './auth';
import { capabilitiesFor } from '@shared/permissions';
import { buildReport } from './services/reports';
import { reportFileName, reportToBlob } from './services/excel';
import type { Query } from './query';

/**
 * The browser-hosted API.
 *
 * Every route the screens call is implemented here against IndexedDB, so the
 * exact same interface runs as a desktop application over Express or as a static
 * site on GitHub Pages with nothing behind it.
 */

interface Route {
  method: string;
  segments: string[];
  params: number;
  handler: (context: Context) => unknown | Promise<unknown>;
}

const routes: Route[] = Object.entries(handlers)
  .map(([key, handler]) => {
    const [method, path] = key.split(' ');
    const segments = path.split('/').filter(Boolean);
    return {
      method,
      segments,
      params: segments.filter((segment) => segment.startsWith(':')).length,
      handler,
    };
  })
  // Static routes are matched before parameterised ones of the same shape.
  .sort((a, b) => a.params - b.params);

function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.method !== method || route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < route.segments.length; index += 1) {
      const segment = route.segments[index];
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[index]);
      else if (segment !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

let ready: Promise<void> | null = null;

/** Opens the database, creates the administrator and seeds a first-run demo. */
export function bootstrapLocalApi(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    await loadDatabase();
    await ensureAdminUser();

    const data = db();
    const meta = syncMeta();
    const empty = data.projects.length === 0 && data.leads.length === 0 && data.materials.length === 0;

    // Only a browser that has never opened the app gets the sample data. An
    // empty database on a browser that has been set up is empty on purpose —
    // someone erased it to start entering real records.
    if (empty && !meta.initialised) {
      buildDemoData(data);
      const defaults = {
        companyName: 'Aasma Construction',
        companyAddress: 'Aasma House, Ring Road, Indore, Madhya Pradesh 452001',
        companyPhone: '+91 731 400 8800',
        companyEmail: 'contact@aasmaconstruction.in',
        gstNo: '23AAAAA0000A1Z5',
        currency: '₹',
        financialYearStart: '04-01',
        lowStockAlerts: true,
        followUpReminderDays: 3,
      };
      data.settings.push({ key: 'app.settings', value: JSON.stringify(defaults), updatedAt: new Date() });
      save(
        'projects',
        'projectStages',
        'stageProgressLogs',
        'milestones',
        'properties',
        'clients',
        'bookings',
        'payments',
        'interactions',
        'leads',
        'leadActivities',
        'materials',
        'purchases',
        'materialUsages',
        'stockAdjustments',
        'workers',
        'attendances',
        'dprs',
        'dprMaterials',
        'settings',
      );
      saveSyncMeta({ demoData: true, initialised: true });
      await flush();
    } else if (!meta.initialised) {
      saveSyncMeta({ initialised: true });
      await flush();
    }
  })();
  return ready;
}

export interface LocalRequest {
  method: string;
  path: string;
  query?: Query;
  body?: unknown;
  form?: FormData;
  token: string | null;
}

/**
 * Runs one request. The result is passed through JSON so callers receive exactly
 * what the HTTP API would have sent — ISO date strings and plain objects.
 */
export async function localRequest<T>(request: LocalRequest): Promise<T> {
  await bootstrapLocalApi();

  const found = match(request.method, request.path);
  if (!found) {
    throw describeError(new Error(`No local route for ${request.method} ${request.path}`));
  }

  try {
    const result = await found.route.handler({
      params: found.params,
      query: request.query ?? {},
      body: request.body,
      form: request.form,
      token: request.token,
    });

    // The moment someone enters real data, this is no longer a sample database
    // and joining a repository merges rather than replaces. Signing in, syncing
    // and taking a backup do not count as entering data.
    const housekeeping = /^\/(auth|sync|backups)\b/.test(request.path);
    if (request.method !== 'GET' && !housekeeping && syncMeta().demoData) {
      saveSyncMeta({ demoData: false });
    }

    await flush();
    return JSON.parse(JSON.stringify(result ?? null)) as T;
  } catch (error) {
    throw describeError(error);
  }
}

/** Report exports and backup downloads, produced as a file in the browser. */
export async function localDownload(
  path: string,
  query: Query,
  token: string | null,
): Promise<{ blob: Blob; filename: string }> {
  await bootstrapLocalApi();
  if (!token) throw describeError(new Error('Sign in to continue.'));

  const reportMatch = /^\/reports\/([A-Za-z0-9_-]+)\/export$/.exec(path);
  if (reportMatch) {
    const viewer = userForToken(token);
    const allowed = capabilitiesFor(viewer?.role);
    if (reportMatch[1] === 'properties' && !allowed.properties) {
      throw describeError(new Error('Only an administrator can export the property report.'));
    }
    const report = buildReport(reportMatch[1], query, { properties: allowed.properties });
    const settings = readSettings();
    return {
      blob: await reportToBlob(report, {
        companyName: settings.companyName,
        companyAddress: settings.companyAddress,
        companyPhone: settings.companyPhone,
        gstNo: settings.gstNo,
        currency: settings.currency,
      }),
      filename: reportFileName(report),
    };
  }

  const backupMatch = /^\/backups\/(.+)\/download$/.exec(path);
  if (backupMatch) {
    const name = decodeURIComponent(backupMatch[1]);
    const backup = db().backups.find((row) => row.name === name);
    if (!backup) throw describeError(new Error('Backup not found.'));
    return { blob: new Blob([backup.payload], { type: 'application/json' }), filename: name };
  }

  throw describeError(new Error(`Nothing to download at ${path}`));
}
