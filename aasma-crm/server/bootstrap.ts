import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, databaseUrl, ensureDirectories } from './lib/paths';
import { prisma, tuneSqlite } from './lib/prisma';
import { hashPassword } from './lib/auth';

/**
 * Makes sure there is a usable database before the API accepts a request.
 *
 * Three situations, in order of preference:
 *   1. The database already exists — nothing to do.
 *   2. A template database was shipped with the build — copy it. This is how a
 *      packaged install starts up on a machine with no toolchain and no network.
 *   3. Neither — run `prisma db push` from the local node_modules (development
 *      and "run from source" installs).
 */
export function ensureDatabase(): void {
  ensureDirectories();
  if (fs.existsSync(PATHS.databaseFile) && fs.statSync(PATHS.databaseFile).size > 0) return;

  if (fs.existsSync(PATHS.templateDatabase)) {
    fs.copyFileSync(PATHS.templateDatabase, PATHS.databaseFile);
    console.log('[db] created a new database from the shipped template.');
    return;
  }

  const cli = path.join(PATHS.appRoot, 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(cli)) {
    throw new Error(
      `No database found at ${PATHS.databaseFile} and no way to create one. ` +
        'Run "npm run db:setup" in the application folder.',
    );
  }

  console.log('[db] no database found — creating one from the Prisma schema…');
  execFileSync(process.execPath, [cli, 'db', 'push', '--skip-generate'], {
    cwd: PATHS.appRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Lets this work when the host process is Electron rather than plain Node.
      ELECTRON_RUN_AS_NODE: '1',
      DATABASE_URL: databaseUrl(),
    },
  });
}

export const DEFAULT_ADMIN = { username: 'admin', password: 'admin@123' };

/** Creates the first administrator so a fresh install can be signed into. */
export async function ensureAdminUser(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;

  await prisma.user.create({
    data: {
      username: DEFAULT_ADMIN.username,
      fullName: 'Administrator',
      role: 'ADMIN',
      passwordHash: await hashPassword(DEFAULT_ADMIN.password),
    },
  });
  console.log(
    `[auth] created the default administrator — username "${DEFAULT_ADMIN.username}", password "${DEFAULT_ADMIN.password}". Change it from Settings after signing in.`,
  );
}

export async function prepareDatabase(): Promise<void> {
  ensureDatabase();
  await tuneSqlite();
  await ensureAdminUser();
}
