import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma';
import { HttpError, unauthorized } from './errors';
import type { AuthUser } from '../../shared/types';

const TOKEN_TTL = '12h';
const SECRET_KEY = 'auth.jwtSecret';

let cachedSecret: string | null = null;

/**
 * The signing secret is generated on first run and kept in the local database,
 * so a copied install cannot reuse another machine's tokens. There is no login
 * server involved — the whole exchange happens inside this process.
 */
export async function getSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const existing = await prisma.setting.findUnique({ where: { key: SECRET_KEY } });
  if (existing) {
    cachedSecret = existing.value;
    return cachedSecret;
  }
  const secret = crypto.randomBytes(48).toString('hex');
  await prisma.setting.create({ data: { key: SECRET_KEY, value: secret } });
  cachedSecret = secret;
  return secret;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function issueToken(user: AuthUser): Promise<string> {
  const secret = await getSecret();
  return jwt.sign({ sub: String(user.id), username: user.username, role: user.role }, secret, {
    expiresIn: TOKEN_TTL,
  });
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

/** Rejects anything without a valid, unexpired token for an active user. */
export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw unauthorized('Sign in to continue.');

    const secret = await getSecret();
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) throw unauthorized();

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || !user.active) throw unauthorized('This account is no longer active.');

    req.user = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(unauthorized('Your session expired. Please sign in again.'));
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      next(unauthorized());
      return;
    }
    next(error);
  }
}

/** Route guard for actions only an administrator may perform. */
export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new HttpError(403, 'You do not have access to this action.'));
      return;
    }
    next();
  };
}
