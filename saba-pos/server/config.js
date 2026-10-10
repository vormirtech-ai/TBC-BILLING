/**
 * Server configuration.
 *
 * Everything an installer can change is an environment variable with a
 * sensible default, so a stock install needs no .env at all and a tuned one
 * needs no code change. See .env.example for the full list.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const str = (name, fallback) => process.env[name] ?? fallback;
const int = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a whole number, got ${JSON.stringify(raw)}`);
  }
  return n;
};
const bool = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
};

export const config = {
  root: ROOT,
  appDir: resolve(ROOT, 'app'),

  host: str('SABA_HOST', '0.0.0.0'),
  port: int('SABA_PORT', 8080),

  /** Where the database and backups live. One directory to back up. */
  dataDir: resolve(ROOT, str('SABA_DATA_DIR', 'data')),

  /**
   * Trust X-Forwarded-For. Only switch this on when the server genuinely sits
   * behind a reverse proxy you control — otherwise any client can spoof its
   * address and defeat the PIN rate limiter.
   */
  trustProxy: bool('SABA_TRUST_PROXY', false),

  /**
   * Set this when the app is served over HTTPS so the session cookie is
   * marked Secure. Left off for a plain LAN install, where it would stop the
   * cookie being set at all.
   */
  secureCookies: bool('SABA_SECURE_COOKIES', false),

  sessionHours: int('SABA_SESSION_HOURS', 14),

  /** The PIN the first manager account is created with on an empty database. */
  setupPin: str('SABA_SETUP_PIN', ''),

  /**
   * Fill a brand-new database with a worked example service — the carte, the
   * floor plan, a month of trading and tables mid-meal. On for a demo or a
   * sales pitch, off for a real restaurant's first day.
   */
  seedDemo: bool('SABA_SEED_DEMO', false),

  logLevel: str('SABA_LOG_LEVEL', 'info'),

  /** How often an idle SSE connection is nudged so proxies do not drop it. */
  heartbeatSeconds: int('SABA_HEARTBEAT_SECONDS', 25),

  /** Keep this many nightly backups before the oldest is deleted. */
  backupKeep: int('SABA_BACKUP_KEEP', 14),

  /* --- the cloud copy, if the restaurant wants one ------------------- */

  /**
   * A Supabase project to mirror the till into. Leave both blank and the
   * sync never starts: Saba is a local-first system and a restaurant that
   * wants nothing to do with the cloud should have to do nothing about it.
   */
  supabaseUrl: str('SABA_SUPABASE_URL', ''),

  /**
   * The service role key. It bypasses row-level security by design, so it
   * belongs in this process's environment and nowhere else — never in the
   * database, never in a reply to a browser, never in the log.
   */
  supabaseKey: str('SABA_SUPABASE_KEY', ''),

  /** How often the sync runs. It is a backup, not a live link. */
  syncMinutes: int('SABA_SYNC_MINUTES', 10),
};

/**
 * Override configuration before the server starts.
 *
 * Used by the tests, which run a server per case on its own port and its own
 * temporary database — and by anyone embedding Saba in a larger process. The
 * environment is still the normal way to configure an install; this is the
 * programmatic door to the same values.
 */
export function configure(overrides = {}) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (!(key in config)) throw new Error(`Unknown setting ${key}`);
    config[key] = value;
  }
  return config;
}

export default config;
