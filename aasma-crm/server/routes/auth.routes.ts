import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, unauthorized } from '../lib/errors';
import { hashPassword, issueToken, requireAuth, verifyPassword, type AuthedRequest } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { changePasswordSchema, loginSchema } from '../../shared/schemas';
import type { LoginResponse } from '../../shared/types';

export const authRouter = Router();

/**
 * Local sign-in. There is no remote identity provider: the hash is compared
 * against the row in the local SQLite file and a short-lived token is issued.
 */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });

    // Same message either way, so the form cannot be used to discover usernames.
    if (!user || !user.active) throw unauthorized('Incorrect username or password.');
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw unauthorized('Incorrect username or password.');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const authUser = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
    const token = await issueToken(authUser);
    await logActivity({ actor: user.username, action: 'LOGIN', entity: 'User', entityId: user.id });

    const body: LoginResponse = { token, user: authUser };
    res.json(body);
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    res.json(req.user);
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw unauthorized('Your current password is not correct.');

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await logActivity({ actor: user.username, action: 'CHANGE_PASSWORD', entity: 'User', entityId: user.id });
    res.json({ ok: true });
  }),
);
