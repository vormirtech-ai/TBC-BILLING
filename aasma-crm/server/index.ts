import type { Server } from 'node:http';
import { createApp } from './app';
import { prepareDatabase } from './bootstrap';
import { disconnectPrisma } from './lib/prisma';

export interface RunningServer {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

const DEFAULT_PORT = Number(process.env.API_PORT ?? 4317);

/**
 * Starts the API on the first free port from the preferred one upwards, so a
 * second copy of the app (or an unrelated service) cannot stop it from opening.
 */
export async function startServer(preferredPort = DEFAULT_PORT): Promise<RunningServer> {
  await prepareDatabase();
  const app = createApp();

  const listen = (port: number): Promise<Server> =>
    new Promise((resolve, reject) => {
      const server = app.listen(port, '127.0.0.1');
      server.once('listening', () => resolve(server));
      server.once('error', reject);
    });

  let server: Server | null = null;
  let port = preferredPort;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      server = await listen(port);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') throw error;
      port += 1;
    }
  }
  if (!server) throw new Error('Could not find a free port for the local API.');

  const running = server;
  console.log(`[api] Aasma Buildcon CRM API listening on http://127.0.0.1:${port}`);

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      await new Promise<void>((resolve) => running.close(() => resolve()));
      await disconnectPrisma();
    },
  };
}
