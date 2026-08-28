import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import { PATHS } from './lib/paths';
import { errorMiddleware } from './lib/errors';
import { requireAuth } from './lib/auth';
import { authRouter } from './routes/auth.routes';
import { leadsRouter } from './routes/leads.routes';
import { bookingsRouter, clientsRouter, paymentsRouter } from './routes/clients.routes';
import { milestonesRouter, projectsRouter } from './routes/projects.routes';
import { propertiesRouter } from './routes/properties.routes';
import { adjustmentsRouter, materialsRouter, purchasesRouter, usageRouter } from './routes/inventory.routes';
import { attendanceRouter, workersRouter } from './routes/labour.routes';
import { dprRouter } from './routes/dpr.routes';
import { dashboardRouter } from './routes/dashboard.routes';
import { forecastRouter } from './routes/forecast.routes';
import { reportsRouter } from './routes/reports.routes';
import { settingsRouter, usersRouter } from './routes/settings.routes';
import { backupRouter } from './routes/backup.routes';
import { searchRouter } from './routes/search.routes';

/**
 * The whole API. It only ever listens on the loopback interface, so nothing on
 * the network can reach it — this is a single-machine application.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(compression());
  app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/], credentials: false }));
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: '1.0.0', database: PATHS.databaseFile });
  });

  app.use('/api/auth', authRouter);

  // Everything below this line needs a valid token.
  const api = express.Router();
  api.use(requireAuth);
  api.use('/dashboard', dashboardRouter);
  api.use('/leads', leadsRouter);
  api.use('/clients', clientsRouter);
  api.use('/bookings', bookingsRouter);
  api.use('/payments', paymentsRouter);
  api.use('/projects', projectsRouter);
  api.use('/milestones', milestonesRouter);
  api.use('/properties', propertiesRouter);
  api.use('/materials', materialsRouter);
  api.use('/purchases', purchasesRouter);
  api.use('/usage', usageRouter);
  api.use('/adjustments', adjustmentsRouter);
  api.use('/workers', workersRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/dpr', dprRouter);
  api.use('/forecast', forecastRouter);
  api.use('/reports', reportsRouter);
  api.use('/settings', settingsRouter);
  api.use('/users', usersRouter);
  api.use('/backups', backupRouter);
  api.use('/search', searchRouter);
  app.use('/api', api);

  // Locally stored DPR photos and client documents.
  app.use('/files', express.static(PATHS.uploadsDir, { maxAge: '1h', index: false, dotfiles: 'deny' }));

  // In production the built renderer is served from the same origin, which keeps
  // the packaged app working without any dev server.
  if (process.env.NODE_ENV !== 'development') {
    app.use(express.static(PATHS.rendererDir, { index: 'index.html' }));
    app.get(/^(?!\/api|\/files).*/, (_req, res) => {
      res.sendFile(path.join(PATHS.rendererDir, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'That endpoint does not exist.' });
  });
  app.use(errorMiddleware);

  return app;
}
