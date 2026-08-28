import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, badRequest } from '../lib/errors';
import { hashPassword, requireRole, type AuthedRequest } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { getSettings, saveSettings } from '../lib/settings';
import { userSchema } from '../../shared/schemas';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    res.json(await getSettings());
  }),
);

settingsRouter.put(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const saved = await saveSettings(req.body);
    await logActivity({ actor: req.user?.username ?? 'system', action: 'UPDATE', entity: 'Settings' });
    res.json(saved);
  }),
);

// ------------------------------------------------------------------ users

export const usersRouter = Router();

usersRouter.get(
  '/',
  requireRole('ADMIN'),
  asyncHandler<AuthedRequest>(async (_req, res) => {
    const rows = await prisma.user.findMany({
      select: { id: true, username: true, fullName: true, role: true, active: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(rows);
  }),
);

usersRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const input = userSchema.parse(req.body);
    if (!input.password) throw badRequest('Set a password for the new user.');

    const user = await prisma.user.create({
      data: {
        username: input.username.toLowerCase(),
        fullName: input.fullName,
        role: input.role,
        active: input.active,
        passwordHash: await hashPassword(input.password),
      },
      select: { id: true, username: true, fullName: true, role: true, active: true },
    });
    await logActivity({ actor: req.user?.username ?? 'system', action: 'CREATE', entity: 'User', entityId: user.id });
    res.status(201).json(user);
  }),
);

usersRouter.put(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const id = Number(req.params.id);
    const input = userSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id },
      data: {
        username: input.username.toLowerCase(),
        fullName: input.fullName,
        role: input.role,
        active: input.active,
        ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      },
      select: { id: true, username: true, fullName: true, role: true, active: true },
    });
    await logActivity({ actor: req.user?.username ?? 'system', action: 'UPDATE', entity: 'User', entityId: id });
    res.json(user);
  }),
);

usersRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const id = Number(req.params.id);
    if (req.user?.id === id) throw badRequest('You cannot delete the account you are signed in with.');

    const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
    const target = await prisma.user.findUnique({ where: { id } });
    if (target?.role === 'ADMIN' && admins <= 1) throw badRequest('At least one administrator must remain.');

    await prisma.user.delete({ where: { id } });
    await logActivity({ actor: req.user?.username ?? 'system', action: 'DELETE', entity: 'User', entityId: id });
    res.json({ ok: true });
  }),
);
