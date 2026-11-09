import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext';

/**
 * One live connection (WebSocket) to the server, shared by every screen
 * while the user is logged in. The server pushes incident and resource
 * changes through it, so screens update without refreshing.
 */
interface SocketState {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketState>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [state, setState] = useState<SocketState>({ socket: null, connected: false });

  useEffect(() => {
    if (!token) return;
    const socket = io({ auth: { token }, transports: ['websocket'] });
    setState({ socket, connected: false });
    socket.on('connect', () => setState({ socket, connected: true }));
    socket.on('disconnect', () => setState({ socket, connected: false }));
    return () => {
      socket.disconnect();
      setState({ socket: null, connected: false });
    };
  }, [token]);

  return <SocketContext.Provider value={state}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketState {
  return useContext(SocketContext);
}
