import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import { newUlid, SignVideoFragmentsRequest } from '@meetyou/contracts';
import { WebSocketServer } from 'ws';

import type { ChunkStore } from './chunk-store.ts';
import { errorCode, log } from './log.ts';
import { StreamSession } from './session.ts';
import type { SttProvider } from './stt/types.ts';
import { DevTokenIssuer, DevVideoSigner } from './tokens.ts';

/** Matches the extension's stream client (extension/src/offscreen/stream-client.ts). */
export const SUBPROTOCOL = 'minutes.v1';
export const TOKEN_PROTOCOL_PREFIX = 'token.';
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_SIGN_BODY_BYTES = 16 * 1024;
/** Standard quality is ~1.3 MB per 10 s fragment (ADR-0011 §3.2); the cap leaves room for keyframes. */
export const MAX_VIDEO_FRAGMENT_BYTES = 8 * 1024 * 1024;

const SIGN_PATH = /^\/v1\/dev\/sessions\/([A-Za-z0-9_]+)\/video\/fragments:sign$/;
const VIDEO_PUT_PATH = /^\/v1\/dev\/video\/([A-Za-z0-9_-]+)$/;

export interface GatewayOptions {
  store: ChunkStore;
  stt: SttProvider | null;
  /** Dev session endpoints exist only here; real sessions come from the API (S2, ADR-0004). */
  devEndpoints: boolean;
  workspaceId?: string;
  tokens?: DevTokenIssuer;
  videoSigner?: DevVideoSigner;
}

export interface Gateway {
  server: Server;
  sessions: Map<string, StreamSession>;
  close(): Promise<void>;
}

// Local dev only: the extension origin is chrome-extension://<id>, which varies per install.
const DEV_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, PUT',
  'access-control-allow-headers': 'content-type',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', ...DEV_CORS });
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'too_large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** `video/mp4; codecs=…` → `video/mp4`. */
function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
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

  const videoSigner = options.videoSigner ?? new DevVideoSigner();

  /** Dev stand-in for `fragments:sign` (ADR-0011 §3.3): URLs only for a session this gateway holds. */
  const signVideo = async (req: IncomingMessage, res: ServerResponse, sessionId: string) => {
    if (!sessions.has(sessionId)) throw new HttpError(404, 'not_found');
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req, MAX_SIGN_BODY_BYTES)).toString('utf8'));
    } catch (error: unknown) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'invalid_json');
    }
    const request = SignVideoFragmentsRequest.safeParse(body);
    if (!request.success) throw new HttpError(400, 'invalid_request');
    const { partId, indices, contentType } = request.data;
    const host = req.headers.host ?? 'localhost';
    const fragments = indices.map((index) => {
      const signed = videoSigner.sign({ sessionId, partId, index, contentType });
      return {
        index,
        url: `http://${host}/v1/dev/video/${signed.token}`,
        expiresAt: new Date(signed.expiresAt).toISOString(),
      };
    });
    log('video.signed', { sessionId, partId, fragments: fragments.length });
    json(res, 201, { fragments });
  };

  /** The PUT a signed URL allows: one fragment, its content type, bounded size, idempotent. */
  const putVideo = async (req: IncomingMessage, res: ServerResponse, token: string) => {
    const upload = videoSigner.resolve(token);
    if (upload === null) throw new HttpError(403, 'url_expired_or_unknown');
    if (mediaType(req.headers['content-type']) !== upload.contentType) {
      throw new HttpError(400, 'content_type_mismatch');
    }
    const bytes = await readBody(req, MAX_VIDEO_FRAGMENT_BYTES);
    if (bytes.length === 0) throw new HttpError(400, 'empty_fragment');
    await options.store.putVideoFragment({
      workspaceId,
      meetingId: upload.sessionId,
      partId: upload.partId,
      index: upload.index,
      bytes,
    });
    log('video.fragment_stored', {
      sessionId: upload.sessionId,
      partId: upload.partId,
      index: upload.index,
      bytes: bytes.length,
    });
    json(res, 200, { ok: true });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://gateway');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      json(res, 200, { ok: true });
      return;
    }
    if (!options.devEndpoints) throw new HttpError(404, 'not_found');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, DEV_CORS);
      res.end();
      return;
    }
    const putToken = VIDEO_PUT_PATH.exec(url.pathname)?.[1];
    if (req.method === 'PUT' && putToken !== undefined) {
      await putVideo(req, res, putToken);
      return;
    }
    if (req.method !== 'POST') throw new HttpError(404, 'not_found');
    const signSession = SIGN_PATH.exec(url.pathname)?.[1];
    if (signSession !== undefined) {
      await signVideo(req, res, signSession);
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
    throw new HttpError(404, 'not_found');
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        json(res, error.status, { error: error.message });
        return;
      }
      log('http.error', { code: errorCode(error) });
      json(res, 500, { error: 'internal' });
    });
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
