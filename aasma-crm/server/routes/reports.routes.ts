import { Router } from 'express';
import { asyncHandler, badRequest } from '../lib/errors';
import type { AuthedRequest } from '../lib/auth';
import { parseListQuery } from '../lib/query';
import { getSettings } from '../lib/settings';
import { logActivity } from '../lib/activity';
import { REPORTS, buildReport } from '../services/report.service';
import { reportFileName, reportToWorkbook, workbookBuffer } from '../services/excel.service';

export const reportsRouter = Router();

reportsRouter.get(
  '/',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    res.json(REPORTS);
  }),
);

reportsRouter.get(
  '/:key',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const key = String(req.params.key);
    if (!REPORTS.some((report) => report.key === key)) throw badRequest('Unknown report.');
    res.json(await buildReport(key, parseListQuery(req)));
  }),
);

/** Same data as the on-screen report, delivered as a formatted workbook. */
reportsRouter.get(
  '/:key/export',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const key = String(req.params.key);
    if (!REPORTS.some((report) => report.key === key)) throw badRequest('Unknown report.');

    const report = await buildReport(key, parseListQuery(req));
    const settings = await getSettings();
    const workbook = await reportToWorkbook(report, settings);
    const buffer = await workbookBuffer(workbook);
    const fileName = reportFileName(report);

    await logActivity({
      actor: req.user?.username ?? 'system',
      action: 'EXPORT',
      entity: 'Report',
      entityId: key,
      detail: `${report.rows.length} row(s)`,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }),
);
