/**
 * friend-link.ts
 * Play a friend: two devices connect directly (WebRTC) with a short room code. On the same Wi-Fi the moves go
 * straight over the local network. Only the first handshake (a few seconds) goes through a small public "signaling"
 * service (PeerJS), so it needs internet for a moment; it also works between different networks.
 *
 * The host is the referee: it picks the colours and sends the full game ("sync") whenever the other side (re)connects.
 */
import type { DataConnection, Peer as PeerT } from 'peerjs';

export type Side = 'w' | 'b';

export type Msg =
  | { t: 'hello'; name: string }
  | { t: 'sync'; ucis: string[]; hostColor: Side; hostName: string; result: string | null; gameId: string }
  | { t: 'move'; uci: string; ply: number }
  | { t: 'resign' }
  | { t: 'draw-offer' }
  | { t: 'draw-accept' }
  | { t: 'draw-decline' }
  | { t: 'rematch' };

export type LinkState = 'starting' | 'waiting' | 'connected' | 'reconnecting' | 'closed' | 'error';

export interface FriendLink {
  code: string;
  role: 'host' | 'guest';
  send: (m: Msg) => void;
  close: () => void;
}

const PREFIX = 'chesslens-v1-';
/** No 0/O, 1/I/L: codes are read aloud and typed on phones. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newCode = (n = 4) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

/**
 * Signaling server. The public PeerJS service by default; `?peer=host:port` (remembered) points at your own
 * PeerJS server instead, e.g. one running on a computer of the same network.
 */
function serverOptions(): Record<string, unknown> {
  try {
    const q = new URLSearchParams(window.location.search).get('peer');
    if (q) localStorage.setItem('chesslens:peer-server', q);
    const saved = localStorage.getItem('chesslens:peer-server');
    if (saved && saved !== 'default') {
      const [host, port] = saved.split(':');
      const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
      return { host, port: Number(port) || (local ? 9000 : 443), path: '/', secure: !local };
    }
  } catch { /* ignore */ }
  return {};
}

async function makePeer(id?: string): Promise<PeerT> {
  const { Peer } = await import('peerjs');
  return id ? new Peer(id, { ...serverOptions(), debug: 0 }) : new Peer({ ...serverOptions(), debug: 0 });
}

const ERR_TEXT: Record<string, string> = {
  'peer-unavailable': 'No game with that code. Check the code, and that your friend still has the room open.',
  'unavailable-id': 'That room code is already in use. Try again.',
  network: "Couldn't reach the connection service. Check that you are online.",
  'server-error': "Couldn't reach the connection service. Try again in a moment.",
  'socket-error': "Couldn't reach the connection service. Check that you are online.",
  'browser-incompatible': "This browser can't make direct connections.",
};
export const errorText = (e: unknown) => {
  const type = (e as { type?: string })?.type ?? '';
  return ERR_TEXT[type] ?? 'The connection failed. Try again.';
};

interface Handlers {
  onState: (s: LinkState, detail?: string) => void;
  onMessage: (m: Msg) => void;
  /** Host only: the friend connected (or reconnected); send them the game. */
  onPeerJoined?: () => void;
  /** Guest only: connected to the host (also after a reconnect). `send` works right away. */
  onOpen?: (send: (m: Msg) => void) => void;
}

/** Opens a room and waits for a friend. Only one friend at a time; a reconnect replaces the old connection. */
export async function hostRoom(code: string, h: Handlers): Promise<FriendLink> {
  h.onState('starting');
  const peer = await makePeer(PREFIX + code);
  let conn: DataConnection | null = null;
  let closed = false;
  peer.on('open', () => h.onState('waiting'));
  peer.on('connection', (c) => {
    conn?.close();
    conn = c;
    c.on('open', () => { h.onState('connected'); h.onPeerJoined?.(); });
    c.on('data', (d) => h.onMessage(d as Msg));
    c.on('close', () => { if (!closed && conn === c) h.onState('reconnecting', 'Your friend left. Waiting for them to come back…'); });
  });
  peer.on('disconnected', () => { if (!closed) { try { peer.reconnect(); } catch { /* ignore */ } } });
  peer.on('error', (e) => { if (!closed) h.onState('error', errorText(e)); });
  return {
    code, role: 'host',
    send: (m) => { if (conn?.open) conn.send(m); },
    close: () => { closed = true; conn?.close(); peer.destroy(); h.onState('closed'); },
  };
}

/** Joins a friend's room. Tries again a few times if the connection drops. */
export async function joinRoom(code: string, h: Handlers): Promise<FriendLink> {
  h.onState('starting');
  const peer = await makePeer();
  let conn: DataConnection | null = null;
  let closed = false;
  let tries = 0;
  const connect = () => {
    if (closed) return;
    const c = peer.connect(PREFIX + code, { reliable: true });
    conn = c;
    c.on('open', () => { tries = 0; h.onState('connected'); h.onOpen?.((m) => { if (c.open) c.send(m); }); });
    c.on('data', (d) => h.onMessage(d as Msg));
    c.on('close', () => {
      if (closed || conn !== c) return;
      h.onState('reconnecting', 'Connection lost. Reconnecting…');
      if (tries++ < 8) window.setTimeout(connect, 1500);
      else h.onState('error', 'Lost the connection to your friend.');
    });
  };
  peer.on('open', connect);
  peer.on('disconnected', () => { if (!closed) { try { peer.reconnect(); } catch { /* ignore */ } } });
  peer.on('error', (e) => {
    if (closed) return;
    if ((e as { type?: string }).type === 'peer-unavailable' && conn && tries > 0 && tries < 8) {
      window.setTimeout(connect, 2000); // host briefly gone while reconnecting
      return;
    }
    h.onState('error', errorText(e));
  });
  return {
    code, role: 'guest',
    send: (m) => { if (conn?.open) conn.send(m); },
    close: () => { closed = true; conn?.close(); peer.destroy(); h.onState('closed'); },
  };
}
