import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { asyncHandler, badRequest, notFound } from '../lib/errors';
import { logActivity } from '../lib/activity';
import type { AuthedRequest } from '../lib/auth';
import { PATHS, ensureDirectories } from '../lib/paths';
import { combine, dateFilter, orderBy, paginate, parseListQuery, searchFilter, toPage } from '../lib/query';
import { dprSchema } from '../../shared/schemas';

export const dprRouter = Router();

const include = {
  project: { select: { id: true, name: true, code: true } },
  materials: { include: { material: { select: { id: true, name: true, unit: true } } } },
  photos: true,
};

ensureDirectories();

/** Photos are copied into the local uploads folder — nothing leaves the laptop. */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PATHS.uploadsDir),
    filename: (_req, file, cb) => {
      const safe = path.basename(file.originalname).replace(/[^A-Za-z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

dprRouter.get(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const query = parseListQuery(req);
    const where = combine(
      searchFilter(query.q, ['workCompleted', 'siteIssues', 'safetyNotes', 'machinery', 'preparedBy']),
      dateFilter('reportDate', query.from, query.to),
      query.projectId ? { projectId: query.projectId } : null,
    );

    const [rows, total] = await Promise.all([
      prisma.dpr.findMany({
        where,
        include,
        orderBy: orderBy(query, ['reportDate', 'labourCount', 'createdAt'], 'reportDate'),
        ...paginate(query),
      }),
      prisma.dpr.count({ where }),
    ]);

    res.json(toPage(rows, total, query));
  }),
);

dprRouter.get(
  '/:id',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const row = await prisma.dpr.findUnique({ where: { id: Number(req.params.id) }, include });
    if (!row) throw notFound('Daily progress report');
    res.json(row);
  }),
);

/**
 * Creates a DPR. When `deductStock` is set, the materials listed on the report
 * are also issued from inventory, so the site team enters them only once.
 */
dprRouter.post(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const input = dprSchema.parse(req.body);
    const { materials, deductStock, ...rest } = input;

    const created = await prisma.$transaction(async (tx) => {
      const dpr = await tx.dpr.create({
        data: {
          ...rest,
          preparedBy: rest.preparedBy ?? req.user?.fullName ?? null,
          materials: { create: materials.map((item) => ({ materialId: item.materialId, quantity: item.quantity })) },
        },
        include,
      });

      if (deductStock && materials.length > 0) {
        await tx.materialUsage.createMany({
          data: materials.map((item) => ({
            materialId: item.materialId,
            projectId: input.projectId,
            quantity: item.quantity,
            usedOn: input.reportDate,
            issuedTo: 'Site (via DPR)',
            notes: `Auto-issued from DPR #${dpr.id}`,
          })),
        });
      }

      return dpr;
    });

    await logActivity({
      actor: req.user?.username ?? 'system',
      action: 'CREATE',
      entity: 'DPR',
      entityId: created.id,
    });
    res.status(201).json(created);
  }),
);

dprRouter.put(
  '/:id',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.dpr.findUnique({ where: { id } });
    if (!existing) throw notFound('Daily progress report');

    const input = dprSchema.parse(req.body);
    const { materials, deductStock: _deductStock, ...rest } = input;

    const updated = await prisma.$transaction(async (tx) => {
      // Replacing the material lines is simpler and safer than diffing them.
      await tx.dprMaterial.deleteMany({ where: { dprId: id } });
      return tx.dpr.update({
        where: { id },
        data: {
          ...rest,
          materials: { create: materials.map((item) => ({ materialId: item.materialId, quantity: item.quantity })) },
        },
        include,
      });
    });

    await logActivity({ actor: req.user?.username ?? 'system', action: 'UPDATE', entity: 'DPR', entityId: id });
    res.json(updated);
  }),
);

dprRouter.delete(
  '/:id',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const id = Number(req.params.id);
    const photos = await prisma.dprPhoto.findMany({ where: { dprId: id } });
    await prisma.dpr.delete({ where: { id } });
    for (const photo of photos) {
      const file = path.join(PATHS.uploadsDir, path.basename(photo.filePath));
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    }
    await logActivity({ actor: req.user?.username ?? 'system', action: 'DELETE', entity: 'DPR', entityId: id });
    res.json({ ok: true });
  }),
);

dprRouter.post(
  '/:id/photos',
  upload.array('photos', 10),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const dprId = Number(req.params.id);
    const dpr = await prisma.dpr.findUnique({ where: { id: dprId } });
    if (!dpr) throw notFound('Daily progress report');

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw badRequest('Attach at least one image (JPG, PNG, WEBP or GIF, up to 12 MB).');

    const caption = typeof req.body.caption === 'string' ? req.body.caption.slice(0, 200) : null;
    await prisma.dprPhoto.createMany({
      data: files.map((file) => ({ dprId, filePath: file.filename, caption })),
    });

    const photos = await prisma.dprPhoto.findMany({ where: { dprId } });
    res.status(201).json(photos);
  }),
);

dprRouter.delete(
  '/photos/:photoId',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const photoId = Number(req.params.photoId);
    const photo = await prisma.dprPhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw notFound('Photo');
    await prisma.dprPhoto.delete({ where: { id: photoId } });
    const file = path.join(PATHS.uploadsDir, path.basename(photo.filePath));
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    res.json({ ok: true });
  }),
);

/** Compact timeline for the DPR screen's left rail. */
dprRouter.get(
  '/timeline/recent',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const rows = await prisma.dpr.findMany({
      where: projectId ? { projectId } : {},
      select: {
        id: true,
        reportDate: true,
        weather: true,
        labourCount: true,
        workCompleted: true,
        project: { select: { name: true } },
        _count: { select: { photos: true, materials: true } },
      },
      orderBy: { reportDate: 'desc' },
      take: 60,
    });
    res.json(rows);
  }),
);
