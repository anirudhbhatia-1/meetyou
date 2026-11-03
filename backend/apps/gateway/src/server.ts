import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import { newUlid } from '@meetyou/contracts';
import { WebSocketServer } from 'ws';

import type { ChunkStore } from './chunk-store.ts';
import { log } from './log.ts';
import { StreamSession } from './session.ts';
import type { SttProvider } from './stt/types.ts';
import { DevTokenIssuer } from './tokens.ts';

/** Matches the extension's stream client (extension/src/offscreen/stream-client.ts). */
export const SUBPROTOCOL = 'minutes.v1';
export const TOKEN_PROTOCOL_PREFIX = 'token.';
const MAX_FRAME_BYTES = 64 * 1024;

export interface GatewayOptions {
  store: ChunkStore;
  stt: SttProvider | null;
  /** Dev session endpoints exist only here; real sessions come from the API (S2, ADR-0004). */
  devEndpoints: boolean;
  workspaceId?: string;
  tokens?: DevTokenIssuer;
}

export interface Gateway {
  server: Server;
  sessions: Map<string, StreamSession>;
  close(): Promise<void>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    // Local dev only: the extension origin is chrome-extension://<id>, which varies per install.
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/** Parses `Sec-WebSocket-Protocol` into the token, if the client offered `minutes.v1`. */
export function tokenFromProtocols(header: string | undefined): string | null {
  const offered = (header ?? '').split(',').map((p) => p.trim());
  if (!offered.includes(SUBPROTOCOL)) return null;
  const token = offered.find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX));
  return token === undefined ? null : token.slice(TOKEN_PROTOCOL_PREFIX.length);
}

export function createGateway(options: GatewayOptions): Gateway {
  const tokens = options.tokens ?? new DevTokenIssuer();
  const workspaceId = options.workspaceId ?? 'dev';
  const sessions = new Map<string, StreamSession>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://gateway');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      json(res, 200, { ok: true });
      return;
    }
    if (!options.devEndpoints || req.method !== 'POST') {
      json(res, 404, { error: 'not_found' });
      return;
    }
    if (url.pathname === '/v1/dev/sessions') {
      const sessionId = `ses_${newUlid()}`;
      sessions.set(
        sessionId,
        new StreamSession({ sessionId, workspaceId, store: options.store, stt: options.stt }),
      );
      const host = req.headers.host ?? 'localhost';
      log('session.created', { sessionId });
      json(res, 201, { sessionId, streamUrl: `ws://${host}/v1/stream` });
      return;
    }
    const match = /^\/v1\/dev\/sessions\/([A-Za-z0-9_]+)\/stream-token$/.exec(url.pathname);
    const sessionId = match?.[1];
    if (sessionId !== undefined && sessions.has(sessionId)) {
      json(res, 201, { streamToken: tokens.issue(sessionId) });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://gateway');
    if (url.pathname !== '/v1/stream') {
      reject(socket, 404, 'Not Found');
      return;
    }
    const token = tokenFromProtocols(req.headers['sec-websocket-protocol']);
    const sessionId = token === null ? null : tokens.consume(token);
    const session = sessionId === null ? undefined : sessions.get(sessionId);
    if (session === undefined) {
      log('stream.unauthorized', {});
      reject(socket, 401, 'Unauthorized');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      log('stream.connected', { sessionId: session.sessionId });
      session.attach(ws);
    });
  });

  return {
    server,
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}
