import { PrismaClient } from '@prisma/client';
import { databaseUrl, ensureDirectories } from './paths';

ensureDirectories();

/**
 * One Prisma client for the whole process. The datasource URL is set here at
 * runtime rather than from .env, because the packaged app keeps its database in
 * Electron's userData folder.
 */
export const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl() } },
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * SQLite performs far better for this workload with write-ahead logging on.
 * `PRAGMA journal_mode` answers with a row, so these go through $queryRawUnsafe;
 * a pragma a particular build refuses is not worth failing start-up over.
 */
export async function tuneSqlite(): Promise<void> {
  const pragmas = [
    'PRAGMA journal_mode = WAL;',
    'PRAGMA synchronous = NORMAL;',
    'PRAGMA foreign_keys = ON;',
    'PRAGMA busy_timeout = 5000;',
  ];
  for (const pragma of pragmas) {
    try {
      await prisma.$queryRawUnsafe(pragma);
    } catch (error) {
      console.warn(`[db] could not apply "${pragma}":`, error);
    }
  }
}
