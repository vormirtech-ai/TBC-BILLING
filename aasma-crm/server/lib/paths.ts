import fs from 'node:fs';
import path from 'node:path';

/**
 * Every writable location the CRM uses.
 *
 * Two situations have to work:
 *   - running from the project folder (development, or `npm start` on a laptop),
 *     where data lives next to the code;
 *   - running from a packaged Electron build, where the code sits inside a
 *     read-only asar and Electron passes a writable folder through
 *     AASMA_DATA_DIR.
 */

/** Walks up from this file until it finds the folder holding package.json. */
function findAppRoot(): string {
  let dir = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const APP_ROOT = findAppRoot();

/** Writable root. Electron overrides this with its userData folder. */
export const DATA_ROOT = process.env.AASMA_DATA_DIR
  ? path.resolve(process.env.AASMA_DATA_DIR)
  : APP_ROOT;

export const PATHS = {
  appRoot: APP_ROOT,
  dataRoot: DATA_ROOT,
  dataDir: path.join(DATA_ROOT, 'data'),
  backupsDir: path.join(DATA_ROOT, 'backups'),
  uploadsDir: path.join(DATA_ROOT, 'uploads'),
  reportsDir: path.join(DATA_ROOT, 'reports'),
  databaseFile: path.join(DATA_ROOT, 'data', 'aasma-crm.db'),
  /** Empty database shipped with the build, copied on first run. */
  templateDatabase: path.join(APP_ROOT, 'prisma', 'template.db'),
  schemaFile: path.join(APP_ROOT, 'prisma', 'schema.prisma'),
  rendererDir: path.join(APP_ROOT, 'dist'),
};

export function ensureDirectories(): void {
  for (const dir of [PATHS.dataDir, PATHS.backupsDir, PATHS.uploadsDir, PATHS.reportsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function databaseUrl(): string {
  // Prisma wants a URL; on Windows the path contains backslashes, which have to
  // be forward slashes inside a file: URL.
  return `file:${PATHS.databaseFile.split(path.sep).join('/')}`;
}
