import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '../domain';
import { forbidden, unauthorized } from '../utils/httpError';

/** What we store inside a login token (JWT). */
export interface AuthUser {
  id: number;
  name: string;
  role: UserRole;
  resourceId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

/** Returns the user inside a valid token, or null if the token is missing/invalid/expired. */
export function verifyToken(token: string | undefined): AuthUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthUser & jwt.JwtPayload;
    return { id: payload.id, name: payload.name, role: payload.role, resourceId: payload.resourceId };
  } catch {
    return null;
  }
}

/** Blocks the request unless it carries a valid "Authorization: Bearer <token>" header. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return next(unauthorized());
  const user = verifyToken(token);
  if (!user) return next(unauthorized('Your session has expired. Please log in again.'));
  req.user = user;
  next();
}

/** Blocks the request unless the logged-in user has one of the given roles. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}
