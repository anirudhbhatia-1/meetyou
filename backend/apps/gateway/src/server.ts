import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import { newUlid, SignVideoFragmentsRequest } from '@meetyou/contracts';
import { WebSocketServer } from 'ws';

import type { ChunkStore } from './chunk-store.ts';
import { errorCode, log } from './log.ts';
import { videoExtension } from './session-check.ts';
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

/**
 * An ended session stays known this long: video fragments keep uploading after the meeting ends
 * (ADR-0011 §3.3) and need signed URLs. Its audio stream refuses new connections at once
 * (`session_ended`) and its STT streams are already closed.
 */
export const ENDED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const SIGN_PATH = /^\/v1\/dev\/sessions\/([A-Za-z0-9_]+)\/video\/fragments:sign$/;
const VIDEO_PUT_PATH = /^\/v1\/dev\/video\/([A-Za-z0-9_-]+)$/;
const VIDEO_LIST_PATH = /^\/v1\/dev\/sessions\/(ses_[0-9A-HJKMNP-TV-Z]{26})\/video$/;
const VIDEO_PART_PATH =
  /^\/v1\/dev\/sessions\/(ses_[0-9A-HJKMNP-TV-Z]{26})\/video\/(vp_[0-9A-HJKMNP-TV-Z]{26})$/;

/** Fragments 0..n-1 without a hole: what plays (each MediaRecorder part starts at fragment 0). */
export function playableFragments(indices: readonly number[]): number {
  let n = 0;
  while (indices.includes(n)) n += 1;
  return n;
}

export interface GatewayOptions {
  store: ChunkStore;
  stt: SttProvider | null;
  /** Dev session endpoints exist only here; real sessions come from the API (S2, ADR-0004). */
  devEndpoints: boolean;
  workspaceId?: string;
  tokens?: DevTokenIssuer;
  videoSigner?: DevVideoSigner;
  /** Overrides ENDED_SESSION_TTL_MS (tests). */
  endedSessionTtlMs?: number;
}

export interface Gateway {
  server: Server;
  sessions: Map<string, StreamSession>;
  close(): Promise<void>;
}

/**
 * Dev endpoints answer only the extension (`chrome-extension://<id>`, which varies per install)
 * and origin-less tools (CLI scripts, tests). A web page the developer visits must not be able to
 * create sessions or write to the local disk.
 */
export function allowedOrigin(origin: string | undefined): boolean {
  return origin === undefined || origin.startsWith('chrome-extension://');
}

function devCors(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (origin === undefined || !allowedOrigin(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

function json(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', ...devCors(req) });
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
  const evictions = new Map<string, ReturnType<typeof setTimeout>>();

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
    json(req, res, 201, { fragments });
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
    json(req, res, 200, { ok: true });
  };

  /**
   * Dev playback of uploaded video (the side panel's "Show last video"): the uploader deletes local
   * fragments after upload, so the joined part is served from here. Works from disk, also after a
   * restart. TODO(S2-14): signed playback URL of the finalized MP4 (`GET /meetings/{id}/video`).
   */
  const getVideo = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    const list = VIDEO_LIST_PATH.exec(path);
    if (list?.[1] !== undefined) {
      const sessionId = list[1];
      const parts = await options.store.listVideo(workspaceId, sessionId);
      json(req, res, 200, {
        parts: parts.map(({ partId, indices }) => ({
          partId,
          fragments: indices.length,
          playableFragments: playableFragments(indices),
          url: `http://${req.headers.host ?? 'localhost'}/v1/dev/sessions/${sessionId}/video/${partId}`,
        })),
      });
      return;
    }
    const part = VIDEO_PART_PATH.exec(path);
    const sessionId = part?.[1];
    const partId = part?.[2];
    if (sessionId === undefined || partId === undefined) throw new HttpError(404, 'not_found');
    const stored = (await options.store.listVideo(workspaceId, sessionId)).find(
      (p) => p.partId === partId,
    );
    const count = stored === undefined ? 0 : playableFragments(stored.indices);
    if (count === 0) throw new HttpError(404, 'not_found');
    const first = await options.store.readVideoFragment(workspaceId, sessionId, partId, 0);
    const type = videoExtension(first.subarray(0, 8)) === 'webm' ? 'video/webm' : 'video/mp4';
    res.writeHead(200, { 'content-type': type, ...devCors(req) });
    res.write(first);
    for (let i = 1; i < count; i++) {
      res.write(await options.store.readVideoFragment(workspaceId, sessionId, partId, i));
    }
    res.end();
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://gateway');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      json(req, res, 200, { ok: true });
      return;
    }
    if (!options.devEndpoints) throw new HttpError(404, 'not_found');
    if (!allowedOrigin(req.headers.origin)) throw new HttpError(403, 'origin_not_allowed');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, devCors(req));
      res.end();
      return;
    }
    if (req.method === 'GET') {
      await getVideo(req, res, url.pathname);
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
        new StreamSession({
          sessionId,
          workspaceId,
          store: options.store,
          stt: options.stt,
          onEnded: () => {
            const timer = setTimeout(() => {
              evictions.delete(sessionId);
              sessions.delete(sessionId);
            }, options.endedSessionTtlMs ?? ENDED_SESSION_TTL_MS);
            timer.unref();
            evictions.set(sessionId, timer);
          },
        }),
      );
      const host = req.headers.host ?? 'localhost';
      log('session.created', { sessionId });
      json(req, res, 201, { sessionId, streamUrl: `ws://${host}/v1/stream` });
      return;
    }
    const match = /^\/v1\/dev\/sessions\/([A-Za-z0-9_]+)\/stream-token$/.exec(url.pathname);
    const sessionId = match?.[1];
    if (sessionId !== undefined && sessions.has(sessionId)) {
      json(req, res, 201, { streamToken: tokens.issue(sessionId) });
      return;
    }
    throw new HttpError(404, 'not_found');
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        json(req, res, error.status, { error: error.message });
        return;
      }
      log('http.error', { code: errorCode(error) });
      json(req, res, 500, { error: 'internal' });
    });
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Parsed defensively: an exception in this listener would crash the process and every session.
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/v1/stream') {
      reject(socket, 404, 'Not Found');
      return;
    }
    if (!allowedOrigin(req.headers.origin)) {
      log('stream.origin_rejected', {});
      reject(socket, 403, 'Forbidden');
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
    close: async () => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      for (const timer of evictions.values()) clearTimeout(timer);
      evictions.clear();
      await Promise.all([...sessions.values()].map((s) => s.shutdown()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
