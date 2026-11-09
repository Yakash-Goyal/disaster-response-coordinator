import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool';
import type { UserRole } from '../../domain';
import { requireAuth, signToken, type AuthUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { notFound, unauthorized } from '../../utils/httpError';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address'),
  password: z.string().min(1, 'Please enter your password'),
});

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  resourceId: number | null;
  passwordHash: string;
}

/** POST /api/auth/login  -> { token, user } */
authRouter.post('/login', async (req, res) => {
  const { email, password } = validate(loginSchema, req.body);

  const [user] = await query<UserRow>(
    `SELECT id, name, email, role, resource_id AS "resourceId", password_hash AS "passwordHash"
       FROM users WHERE email = $1`,
    [email],
  );

  // Same message for "no such user" and "wrong password", so attackers
  // cannot find out which emails exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Incorrect email or password.');
  }

  const authUser: AuthUser = { id: user.id, name: user.name, role: user.role, resourceId: user.resourceId };
  res.json({ token: signToken(authUser), user: { ...authUser, email: user.email } });
});

/** GET /api/auth/me  -> the logged-in user (used to restore a session on page reload) */
authRouter.get('/me', requireAuth, async (req, res) => {
  const [user] = await query(
    `SELECT id, name, email, role, resource_id AS "resourceId" FROM users WHERE id = $1`,
    [req.user!.id],
  );
  if (!user) throw notFound('This account no longer exists.');
  res.json({ user });
});
