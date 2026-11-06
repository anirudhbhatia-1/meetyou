import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import type { StreamTokenVerification } from '@meetyou/auth';
import { newUlid, SignVideoFragmentsRequest } from '@meetyou/contracts';
import { createMeetingForSession, glossaryTerms, meetingForSession, type Db } from '@meetyou/db';
import type { DisplayTextPolicy } from '@meetyou/hinglish';
import { recordSpan } from '@meetyou/tracing';
import { WebSocketServer } from 'ws';

import type { ChunkStore } from './chunk-store.ts';
import { LocalVideoFinalizer } from './local-finalizer.ts';
import { errorCode, log } from './log.ts';
import { MemorySessionRegistry, type SessionRecord, type SessionRegistry } from './registry.ts';
import { videoExtension } from './session-check.ts';
import { StreamSession } from './session.ts';
import type { SttProvider } from '@meetyou/providers';
import { DbSink, FileSink, type SessionSink } from './sinks.ts';
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
const VIDEO_FILE_PATH =
  /^\/v1\/dev\/sessions\/(ses_[0-9A-HJKMNP-TV-Z]{26})\/video\/(playback|poster)$/;
const FINALIZE_PATH = /^\/v1\/dev\/sessions\/(ses_[0-9A-HJKMNP-TV-Z]{26})\/video:finalize$/;

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
  /** Shared session state (S2-04); in-memory (single instance) when absent. */
  registry?: SessionRegistry;
  /** Verifies API-issued JWT stream tokens (ADR-0004 §4.4); without it only dev tokens work. */
  streamTokens?: StreamTokenVerification;
  /** Meetings, segments and usage in Postgres; files next to the audio when absent. */
  db?: Db;
  /** Overrides where results go (tests); derived from `db` otherwise. */
  sink?: SessionSink;
  display?: DisplayTextPolicy;
  /**
   * Who runs `video.finalize`: `queue` enqueues it when a meeting ends (worker, needs `db`),
   * `local` runs it in this process once uploads are complete (dev), `off` never.
   * Default: `queue` with a database, `local` without.
   */
  videoFinalize?: 'queue' | 'local' | 'off';
  /**
   * Exact WebSocket origins allowed (the pinned extension, STAGING_SETUP §4). Deployed gateways
   * set it; without it the dev rule applies (any extension, or no origin for local tools).
   */
  allowedOrigins?: readonly string[];
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

/**
 * The dev gateway listens on 127.0.0.1 only; a request naming any other host reached it through
 * DNS rebinding (a web page whose domain now resolves to 127.0.0.1) and is refused.
 */
export function allowedHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

/** Resolves false once the client has gone away. */
function writeWithBackpressure(res: ServerResponse, chunk: Uint8Array): Promise<boolean> {
  if (res.destroyed) return Promise.resolve(false);
  if (res.write(chunk)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      resolve(ok);
    };
    const onDrain = done(true);
    const onClose = done(false);
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
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
  /** Sessions held by this instance; the registry knows every session (§6.2). */
  const sessions = new Map<string, StreamSession>();
  const registry = options.registry ?? new MemorySessionRegistry();
  const finalizeMode = options.videoFinalize ?? (options.db === undefined ? 'local' : 'queue');
  const finalizer = finalizeMode === 'local' ? new LocalVideoFinalizer(options.store) : null;
  const sink =
    options.sink ??
    (options.db === undefined
      ? new FileSink(options.store)
      : new DbSink(options.db, options.store, { enqueueVideoFinalize: finalizeMode === 'queue' }));
  /** Takeovers in progress, so two connections for one session build it once. */
  const loading = new Map<string, Promise<StreamSession | null>>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });

  const videoSigner = options.videoSigner ?? new DevVideoSigner();
  const evictions = new Map<string, ReturnType<typeof setTimeout>>();
  // Sessions that never ended (client gone, drain timed out, or created by a timed-out retry)
  // are dropped once nothing has happened for ENDED_SESSION_TTL_MS.
  const abandonedTtlMs = options.endedSessionTtlMs ?? ENDED_SESSION_TTL_MS;
  const sweep = setInterval(
    () => {
      const cutoff = Date.now() - abandonedTtlMs;
      for (const [id, session] of sessions) {
        if (session.ended || session.connected || session.lastActivityAt > cutoff) continue;
        sessions.delete(id);
        void session.shutdown();
        log('session.evicted', { sessionId: id });
        // Never connected anywhere (no codec yet): given up for good, so no instance revives it.
        // One that streamed before stays in the registry, and a late reconnect still resumes.
        void registry
          .get(id)
          .then((record) =>
            record !== null && record.codec === null
              ? registry.update(id, { ended: true, endedAt: Date.now() })
              : undefined,
          )
          .catch((error: unknown) => {
            log('registry.update_failed', { sessionId: id, code: errorCode(error) });
          });
      }
    },
    Math.min(10 * 60 * 1000, abandonedTtlMs),
  );
  sweep.unref();

  const holdSession = (record: SessionRecord): StreamSession => {
    const { sessionId } = record;
    const session = new StreamSession({
      sessionId,
      workspaceId: record.workspaceId,
      meetingId: record.meetingId,
      store: options.store,
      stt: options.stt,
      sink,
      ...(options.display !== undefined ? { display: options.display } : {}),
      keyterms: record.keyterms,
      resume: { codec: record.codec, needsBatch: record.needsBatch },
      onState: (patch) => {
        registry.update(sessionId, patch).catch((error: unknown) => {
          log('registry.update_failed', { sessionId, code: errorCode(error) });
        });
      },
      onEnded: () => {
        // Uploads may already be complete (short call, fast network).
        void finalizer?.request(record.workspaceId, record.meetingId);
        const timer = setTimeout(() => {
          evictions.delete(sessionId);
          sessions.delete(sessionId);
        }, options.endedSessionTtlMs ?? ENDED_SESSION_TTL_MS);
        timer.unref();
        evictions.set(sessionId, timer);
      },
    });
    sessions.set(sessionId, session);
    return session;
  };

  /**
   * The session for a connection: held here, or taken over from the registry (another instance
   * held it and died, §6.2), or — first connect of an API-created session — built from its
   * meeting row. Ended sessions are not taken over. `tokenWorkspace` must match when given.
   */
  const sessionFor = async (
    sessionId: string,
    tokenWorkspace?: string,
  ): Promise<StreamSession | null> => {
    const held = sessions.get(sessionId);
    if (held !== undefined) {
      return tokenWorkspace === undefined || held.workspaceId === tokenWorkspace ? held : null;
    }
    const pending = loading.get(sessionId);
    if (pending !== undefined) return pending;
    const load = (async () => {
      let record = await registry.get(sessionId);
      if (record === null && tokenWorkspace !== undefined && options.db !== undefined) {
        const db = options.db;
        const meeting = await db.inWorkspace(tokenWorkspace, (tx) =>
          meetingForSession(tx, sessionId),
        );
        if (meeting === undefined || meeting.endedAt !== null) return null;
        record = {
          sessionId,
          workspaceId: tokenWorkspace,
          meetingId: meeting.id,
          codec: null,
          ended: false,
          endedAt: null,
          stt: 'ok',
          needsBatch: false,
          keyterms: await db.inWorkspace(tokenWorkspace, glossaryTerms),
          createdAt: Date.now(),
        };
        await registry.create(record);
      }
      if (record === null || record.ended) return null;
      if (tokenWorkspace !== undefined && record.workspaceId !== tokenWorkspace) return null;
      log('session.taken_over', { sessionId });
      return sessions.get(sessionId) ?? holdSession(record);
    })();
    loading.set(sessionId, load);
    try {
      return await load;
    } finally {
      loading.delete(sessionId);
    }
  };

  /** Where a session's video lives: its workspace and meeting (any instance, via the registry). */
  const videoTarget = async (
    sessionId: string,
  ): Promise<{ workspaceId: string; meetingId: string; ended: boolean } | null> => {
    const held = sessions.get(sessionId);
    if (held !== undefined) {
      return { workspaceId: held.workspaceId, meetingId: held.meetingId, ended: held.ended };
    }
    const record = await registry.get(sessionId);
    return record === null
      ? null
      : { workspaceId: record.workspaceId, meetingId: record.meetingId, ended: record.ended };
  };

  /** Dev stand-in for `fragments:sign` (ADR-0011 §3.3): URLs only for a session this gateway holds. */
  const signVideo = async (req: IncomingMessage, res: ServerResponse, sessionId: string) => {
    // Held here, or known and not past the ended grace period (late uploads, ADR-0011 §3.3).
    if (!sessions.has(sessionId)) {
      const record = await registry.get(sessionId);
      const graceMs = options.endedSessionTtlMs ?? ENDED_SESSION_TTL_MS;
      if (
        record === null ||
        (record.ended && (record.endedAt === null || Date.now() - record.endedAt > graceMs))
      ) {
        throw new HttpError(404, 'not_found');
      }
    }
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
    const target = await videoTarget(upload.sessionId);
    if (target === null) throw new HttpError(404, 'not_found');
    const bytes = await readBody(req, MAX_VIDEO_FRAGMENT_BYTES);
    if (bytes.length === 0) throw new HttpError(400, 'empty_fragment');
    await options.store.putVideoFragment({
      workspaceId: target.workspaceId,
      meetingId: target.meetingId,
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
    // The last late fragment of an ended meeting completes it (ADR-0011 §3.4).
    if (target.ended) void finalizer?.request(target.workspaceId, target.meetingId);
  };

  /**
   * Dev playback of uploaded video (the side panel's Recording card). Before finalize the parts are
   * served with their fragments joined; after it, `playback.mp4` (with Range, so the player seeks)
   * and `poster.jpg`. Works from disk, also after a restart. `?download=1` saves instead of plays.
   * Deployed, the API serves signed Cloud Storage URLs instead (`GET /v1/meetings/{id}/video`).
   */
  const getVideo = async (
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    download: boolean,
  ) => {
    const host = req.headers.host ?? 'localhost';
    const list = VIDEO_LIST_PATH.exec(path);
    if (list?.[1] !== undefined) {
      const sessionId = list[1];
      const target = await videoTarget(sessionId);
      if (target === null) {
        json(req, res, 200, { parts: [], playback: null });
        return;
      }
      const playback = await options.store.videoFile(
        target.workspaceId,
        target.meetingId,
        'playback.mp4',
      );
      const parts = await options.store.listVideo(target.workspaceId, target.meetingId);
      json(req, res, 200, {
        parts: parts.map(({ partId, indices }) => ({
          partId,
          fragments: indices.length,
          playableFragments: playableFragments(indices),
          url: `http://${host}/v1/dev/sessions/${sessionId}/video/${partId}`,
        })),
        playback:
          playback === null
            ? null
            : {
                url: `http://${host}/v1/dev/sessions/${sessionId}/video/playback`,
                posterUrl: `http://${host}/v1/dev/sessions/${sessionId}/video/poster`,
                bytes: playback.bytes,
              },
      });
      return;
    }
    const file = VIDEO_FILE_PATH.exec(path);
    if (file?.[1] !== undefined && file[2] !== undefined) {
      const name = file[2] === 'playback' ? 'playback.mp4' : 'poster.jpg';
      await sendVideoFile(req, res, file[1], name, download);
      return;
    }
    const part = VIDEO_PART_PATH.exec(path);
    const sessionId = part?.[1];
    const partId = part?.[2];
    if (sessionId === undefined || partId === undefined) throw new HttpError(404, 'not_found');
    const target = await videoTarget(sessionId);
    if (target === null) throw new HttpError(404, 'not_found');
    const { workspaceId: ws, meetingId } = target;
    const stored = (await options.store.listVideo(ws, meetingId)).find((p) => p.partId === partId);
    const count = stored === undefined ? 0 : playableFragments(stored.indices);
    if (count === 0) throw new HttpError(404, 'not_found');
    const first = await options.store.readVideoFragment(ws, meetingId, partId, 0);
    const ext = videoExtension(first.subarray(0, 8)) === 'webm' ? 'webm' : 'mp4';
    const type = `video/${ext}`;
    // IDs are checked by the path patterns above, so the file name needs no escaping.
    const disposition = download
      ? { 'content-disposition': `attachment; filename="minutes-${sessionId}-${partId}.${ext}"` }
      : {};
    res.writeHead(200, { 'content-type': type, ...disposition, ...devCors(req) });
    // One fragment at a time, waiting for the player to drain: an hour-long part is ~470 MB and
    // must not pile up in memory; a closed tab stops the reads.
    if (!(await writeWithBackpressure(res, first))) return;
    for (let i = 1; i < count; i++) {
      const chunk = await options.store.readVideoFragment(ws, meetingId, partId, i);
      if (!(await writeWithBackpressure(res, chunk))) return;
    }
    res.end();
  };

  /** A finalized file, with single-range support (players seek with `Range: bytes=…`). */
  const sendVideoFile = async (
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
    name: 'playback.mp4' | 'poster.jpg',
    download: boolean,
  ) => {
    const target = await videoTarget(sessionId);
    const file =
      target === null
        ? null
        : await options.store.videoFile(target.workspaceId, target.meetingId, name);
    if (file === null) throw new HttpError(404, 'not_found');
    const range = parseRange(req.headers.range, file.bytes);
    if (range === 'invalid') {
      res.writeHead(416, { 'content-range': `bytes */${file.bytes}`, ...devCors(req) });
      res.end();
      return;
    }
    const { start, end } = range ?? { start: 0, end: file.bytes - 1 };
    res.writeHead(range === null ? 200 : 206, {
      'content-type': name === 'poster.jpg' ? 'image/jpeg' : 'video/mp4',
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      ...(range === null ? {} : { 'content-range': `bytes ${start}-${end}/${file.bytes}` }),
      ...(download
        ? { 'content-disposition': `attachment; filename="minutes-${sessionId}-${name}"` }
        : {}),
      ...devCors(req),
    });
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(file.path, { start, end });
      stream.once('error', reject);
      stream.once('end', () => resolve());
      // A closed player stops the read.
      res.once('close', () => {
        stream.destroy();
        resolve();
      });
      stream.pipe(res);
    });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://gateway');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      json(req, res, 200, { ok: true });
      return;
    }
    if (!options.devEndpoints) throw new HttpError(404, 'not_found');
    if (!allowedHost(req.headers.host)) throw new HttpError(403, 'host_not_allowed');
    if (!allowedOrigin(req.headers.origin)) throw new HttpError(403, 'origin_not_allowed');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, devCors(req));
      res.end();
      return;
    }
    if (req.method === 'GET') {
      await getVideo(req, res, url.pathname, url.searchParams.get('download') === '1');
      return;
    }
    const putToken = VIDEO_PUT_PATH.exec(url.pathname)?.[1];
    if (req.method === 'PUT' && putToken !== undefined) {
      await putVideo(req, res, putToken);
      return;
    }
    if (req.method !== 'POST') throw new HttpError(404, 'not_found');
    const finalizeSession = FINALIZE_PATH.exec(url.pathname)?.[1];
    if (finalizeSession !== undefined) {
      // Dev: finalize now with whatever arrived (stands in for the 24 h cap, ADR-0011 §3.4).
      const target = await videoTarget(finalizeSession);
      if (target === null || finalizer === null) throw new HttpError(404, 'not_found');
      void finalizer.request(target.workspaceId, target.meetingId, true);
      json(req, res, 202, { accepted: true });
      return;
    }
    const signSession = SIGN_PATH.exec(url.pathname)?.[1];
    if (signSession !== undefined) {
      await signVideo(req, res, signSession);
      return;
    }
    if (url.pathname === '/v1/dev/sessions') {
      const sessionId = `ses_${newUlid()}`;
      // With a database the dev session records into a real meeting row (DEV_WORKSPACE_ID); the
      // API's `POST /sessions` does the same for real users (S2-09).
      let meetingId = sessionId;
      let keyterms: string[] = [];
      if (options.db !== undefined) {
        meetingId = `mtg_${newUlid()}`;
        const id = meetingId;
        await options.db.inWorkspace(workspaceId, (tx) =>
          createMeetingForSession(tx, {
            id,
            workspaceId,
            sessionId,
            externalMeetingCode: null,
            startedAt: new Date(),
          }),
        );
        keyterms = await options.db.inWorkspace(workspaceId, glossaryTerms);
      }
      const record: SessionRecord = {
        sessionId,
        workspaceId,
        meetingId,
        codec: null,
        ended: false,
        endedAt: null,
        stt: 'ok',
        needsBatch: false,
        keyterms,
        createdAt: Date.now(),
      };
      await registry.create(record);
      holdSession(record);
      const host = req.headers.host ?? 'localhost';
      log('session.created', { sessionId });
      json(req, res, 201, { sessionId, streamUrl: `ws://${host}/v1/stream` });
      return;
    }
    const match = /^\/v1\/dev\/sessions\/([A-Za-z0-9_]+)\/stream-token$/.exec(url.pathname);
    const sessionId = match?.[1];
    if (sessionId !== undefined && (await sessionFor(sessionId)) !== null) {
      json(req, res, 201, { streamToken: tokens.issue(sessionId) });
      return;
    }
    throw new HttpError(404, 'not_found');
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error: unknown) => {
      // A failure mid-stream cannot send a JSON error any more (headers are out); writing one
      // would throw and take the whole process down.
      if (res.headersSent) {
        log('http.stream_failed', { code: errorCode(error) });
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        json(req, res, error.status, { error: error.message });
        return;
      }
      log('http.error', { code: errorCode(error) });
      json(req, res, 500, { error: 'internal' });
    });
  });

  /** The session a stream token admits to, with the token's workspace for JWTs; null if refused. */
  const admit = async (token: string): Promise<StreamSession | null> => {
    if (options.streamTokens !== undefined && token.split('.').length === 3) {
      let claims;
      try {
        claims = await options.streamTokens.verifyStreamToken(token);
      } catch {
        return null;
      }
      // Single use (ADR-0004 §4.4): a replayed token is refused on every instance.
      if (!(await registry.spendTokenId(claims.jti, claims.expiresAt.getTime() - Date.now()))) {
        log('stream.token_replayed', { sessionId: claims.sessionId });
        return null;
      }
      return sessionFor(claims.sessionId, claims.workspaceId);
    }
    if (!options.devEndpoints) return null;
    const sessionId = tokens.consume(token);
    return sessionId === null ? null : sessionFor(sessionId);
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Parsed defensively: an exception in this listener would crash the process and every session.
    const path = (req.url ?? '/').split('?')[0];
    // Loopback only for the dev gateway (DNS rebinding); a deployed gateway sits behind its own host.
    if (options.devEndpoints && !allowedHost(req.headers.host)) {
      reject(socket, 403, 'Forbidden');
      return;
    }
    if (path !== '/v1/stream') {
      reject(socket, 404, 'Not Found');
      return;
    }
    const origin = req.headers.origin;
    const originOk =
      options.allowedOrigins === undefined
        ? allowedOrigin(origin)
        : origin !== undefined && options.allowedOrigins.includes(origin);
    if (!originOk) {
      log('stream.origin_rejected', {});
      reject(socket, 403, 'Forbidden');
      return;
    }
    const token = tokenFromProtocols(req.headers['sec-websocket-protocol']);
    const admitStartMs = Date.now();
    (token === null ? Promise.resolve(null) : admit(token))
      .then((session) => {
        if (session === null) {
          log('stream.unauthorized', {});
          reject(socket, 401, 'Unauthorized');
          return;
        }
        recordSpan(
          'stream.admit',
          session.meetingId,
          { sessionId: session.sessionId },
          admitStartMs,
        );
        wss.handleUpgrade(req, socket, head, (ws) => {
          log('stream.connected', { sessionId: session.sessionId });
          session.attach(ws);
        });
      })
      .catch((error: unknown) => {
        // Registry or database unreachable: the client retries with backoff.
        log('stream.admit_failed', { code: errorCode(error) });
        reject(socket, 503, 'Service Unavailable');
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
      clearInterval(sweep);
      await Promise.all([...sessions.values()].map((s) => s.shutdown()));
      if (options.registry === undefined) await registry.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** One `bytes=start-end` range (open-ended and suffix forms); null without a header. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return 'invalid';
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return 'invalid';
  let start: number;
  let end: number;
  if (from === '') {
    start = Math.max(0, size - Number(to));
    end = size - 1;
  } else {
    start = Number(from);
    end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}
