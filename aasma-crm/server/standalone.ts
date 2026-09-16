/**
 * Runs the CRM without Electron — useful for a shared office machine where the
 * app is opened in a browser at http://localhost:4317 instead.
 *
 *   npm run build && npm run serve
 */
import { startServer } from './index';

async function main(): Promise<void> {
  const server = await startServer();
  console.log(`Open ${server.url} in your browser.`);

  const shutdown = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Could not start the CRM:', error);
  process.exit(1);
});
