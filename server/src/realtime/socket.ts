import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { verifyToken } from '../middleware/auth';
import { logger } from '../utils/logger';

/**
 * Real-time channel (WebSockets via Socket.IO).
 *
 * REST is used to load data; this socket pushes every change to the
 * screens that are already open, so nobody has to refresh.
 *
 * Rooms:
 *   "control-room"  - commanders and admins (see everything)
 *   "user:<id>"     - one specific user (used for responder notifications)
 */
export type ServerEvent =
  | 'incident:updated'
  | 'resource:updated'
  | 'decision:updated'
  | 'feed:status'
  | 'task:assigned';

let io: Server | null = null;

export function initRealtime(httpServer: HttpServer) {
  io = new Server(httpServer, { cors: { origin: env.CLIENT_ORIGIN } });

  // Only logged-in users may connect: the client sends its JWT on connect.
  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    if (user.role === 'commander' || user.role === 'admin') socket.join('control-room');
    logger.info(`Live connection opened by ${user.name} (${user.role})`);
  });
}

/** Push an update to every commander/admin screen. */
export function broadcast(event: ServerEvent, payload: unknown) {
  io?.to('control-room').emit(event, payload);
}

/** Push an update to one user only. */
export function sendToUser(userId: number, event: ServerEvent, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}
