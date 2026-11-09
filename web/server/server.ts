import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Library web app server (Cloud Run, STAGING_SETUP §10): serves the Vite build and proxies `/v1`
 * to the API, so the API's refresh cookie is first-party to the web origin (ADR-0004 §4.5) and the
 * page needs no CORS. `/config.json` carries deploy-time settings to the static build. Node
 * built-ins only.
 */
export interface WebServerOptions {
  staticDir: string;
  apiUrl: string;
  googleClientId: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** Request headers the API needs; everything else stays at the edge. */
const FORWARD_REQUEST = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'if-match',
  'idempotency-key',
  'user-agent',
  'x-minutes-client',
];
const FORWARD_RESPONSE = [
  'cache-control',
  'content-type',
  'etag',
  'retry-after',
  'location',
  // Audio playback's time map (S4-09).
  'x-audio-spans',
];

// Signed video and poster URLs are served by Cloud Storage (V4 signed URLs).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://storage.googleapis.com",
  // Video from signed Cloud Storage URLs; audio is fetched through /v1 and played from a blob.
  'media-src https://storage.googleapis.com blob:',
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function securityHeaders(res: ServerResponse): void {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  // The OAuth callback URL carries the authorization code: never send it on as a Referer.
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('strict-transport-security', 'max-age=31536000');
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export function createWebServer(options: WebServerOptions): Server {
  const root = resolve(options.staticDir);
  const api = new URL(options.apiUrl);
  const config = JSON.stringify({ googleClientId: options.googleClientId });

  async function proxy(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const headers = new Headers();
    for (const name of FORWARD_REQUEST) {
      const value = req.headers[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') headers.set('x-forwarded-for', forwardedFor);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    // A browser that goes away (closed tab, ended progress stream) cancels the API request too.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    const upstream = await fetch(new URL(path, api), {
      method: req.method ?? 'GET',
      headers,
      redirect: 'manual',
      signal: abort.signal,
      ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: 'half' } : {}),
    });
    res.statusCode = upstream.status;
    for (const name of FORWARD_RESPONSE) {
      const value = upstream.headers.get(name);
      if (value !== null) res.setHeader(name, value);
    }
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);
    if (upstream.body === null) {
      res.end();
      return;
    }
    // pipeline, not pipe: an API connection that drops mid-body must end this response, not
    // throw an unhandled stream error that stops the server.
    try {
      await pipeline(
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
        res,
      );
    } catch (error: unknown) {
      if (!abort.signal.aborted) {
        log('proxy.stream_failed', { code: error instanceof Error ? error.name : 'unknown' });
      }
      res.destroy();
    }
  }

  async function file(res: ServerResponse, pathname: string): Promise<void> {
    const decoded = decodeURIComponent(pathname);
    const target = normalize(join(root, decoded));
    let path = target.startsWith(root + sep) ? target : join(root, 'index.html');
    const info = await stat(path).catch(() => null);
    // SPA fallback: /auth/callback and any unknown path load the app.
    if (info === null || !info.isFile()) path = join(root, 'index.html');
    const isIndex = path === join(root, 'index.html');
    res.setHeader('content-type', TYPES[extname(path)] ?? 'application/octet-stream');
    // Vite fingerprints everything under /assets; index.html must always be revalidated.
    res.setHeader(
      'cache-control',
      !isIndex && decoded.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    res.end(await readFile(path));
  }

  return createServer((req, res) => {
    securityHeaders(res);
    const url = new URL(req.url ?? '/', 'http://web.local');
    const handle = async () => {
      if (url.pathname === '/healthz') {
        res.setHeader('content-type', 'text/plain');
        res.end('ok');
      } else if (url.pathname === '/config.json') {
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(config);
      } else if (url.pathname.startsWith('/v1/')) {
        await proxy(req, res, `${url.pathname}${url.search}`);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await file(res, url.pathname);
      } else {
        res.statusCode = 405;
        res.end();
      }
    };
    handle().catch((error: unknown) => {
      log('web.request_failed', {
        path: url.pathname.startsWith('/v1/') ? 'v1' : 'static',
        code: error instanceof Error ? error.name : 'unknown',
      });
      if (!res.headersSent) res.statusCode = url.pathname.startsWith('/v1/') ? 502 : 500;
      res.end();
    });
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? '8080');
  const server = createWebServer({
    staticDir: process.env.STATIC_DIR ?? resolve(import.meta.dirname, '../dist'),
    apiUrl: required('API_URL'),
    googleClientId: required('GOOGLE_CLIENT_ID'),
  });
  server.listen(port, process.env.HOST ?? '0.0.0.0', () => log('web.listening', { port }));
  process.on('SIGTERM', () => server.close());
}
