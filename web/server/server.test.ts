import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWebServer, contentSecurityPolicy } from './server.ts';

const listen = (server: Server) =>
  new Promise<string>((done) =>
    server.listen(0, '127.0.0.1', () => {
      done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    }),
  );

describe('web server', () => {
  let dir: string;
  let web: Server;
  let api: Server;
  let base: string;
  const seen: { url: string; headers: Record<string, unknown>; body: string }[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'minutes-web-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    await writeFile(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    await writeFile(join(tmpdir(), 'minutes-secret.txt'), 'nope');
    api = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        res.setHeader('set-cookie', ['minutes_rt=x; Path=/v1/auth; HttpOnly', 'other=y']);
        res.setHeader('x-internal', 'secret');
        res.statusCode = 201;
        res.end('{"ok":true}');
      });
    });
    web = createWebServer({
      staticDir: dir,
      apiUrl: await listen(api),
      googleClientId: 'client-1.apps.googleusercontent.com',
    });
    base = await listen(web);
  });

  afterAll(async () => {
    web.close();
    api.close();
    await rm(dir, { recursive: true, force: true });
    await rm(join(tmpdir(), 'minutes-secret.txt'), { force: true });
  });

  it('serves the runtime config and the SPA with security headers', async () => {
    const config = await fetch(`${base}/config.json`);
    expect(await config.json()).toEqual({ googleClientId: 'client-1.apps.googleusercontent.com' });
    const callback = await fetch(`${base}/auth/callback?code=c&state=s`);
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain('id="root"');
    expect(callback.headers.get('cache-control')).toBe('no-cache');
    expect(callback.headers.get('referrer-policy')).toBe('no-referrer');
    expect(callback.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const asset = await fetch(`${base}/assets/app-abc123.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toContain('text/javascript');
  });

  it('never serves files outside the build', async () => {
    const res = await fetch(`${base}/..%2Fminutes-secret.txt`);
    expect(await res.text()).not.toContain('nope');
  });

  it('proxies /v1 with the cookie both ways and only allow-listed headers', async () => {
    const res = await fetch(`${base}/v1/auth/refresh?x=1`, {
      method: 'POST',
      headers: {
        cookie: 'minutes_rt=old',
        'x-minutes-client': 'web',
        'content-type': 'application/json',
        'x-evil': '1',
      },
      body: '{"a":1}',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.getSetCookie()).toEqual([
      'minutes_rt=x; Path=/v1/auth; HttpOnly',
      'other=y',
    ]);
    expect(res.headers.get('x-internal')).toBeNull();
    const last = seen.at(-1);
    expect(last?.url).toBe('/v1/auth/refresh?x=1');
    expect(last?.body).toBe('{"a":1}');
    expect(last?.headers).toMatchObject({ cookie: 'minutes_rt=old', 'x-minutes-client': 'web' });
    expect(last?.headers['x-evil']).toBeUndefined();
  });
});

describe('content security policy (ADR-0012)', () => {
  it('allows signed media from the configured storage origin only', () => {
    expect(contentSecurityPolicy()).toContain('media-src https://storage.googleapis.com blob:');
    const azure = contentSecurityPolicy('https://meetyoustaging.blob.core.windows.net');
    expect(azure).toContain("img-src 'self' data: https://meetyoustaging.blob.core.windows.net");
    expect(azure).toContain('media-src https://meetyoustaging.blob.core.windows.net blob:');
    expect(azure).not.toContain('googleapis');
  });
});
