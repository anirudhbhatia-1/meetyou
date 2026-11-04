import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { encodeAudioFrame, packOpusFrame, type Lane } from '@meetyou/contracts';
import WebSocket from 'ws';

/**
 * ARCHITECTURE §26.2 Q6: gateway resource cost per session, without vendor calls (STT off).
 * Starts the gateway as a child process on a temp data dir, runs N sessions that each stream both
 * lanes in real time with synthetic payloads, and samples the gateway's CPU and RSS with `ps`.
 *   node backend/apps/gateway/src/load-test.ts [sessions=10] [seconds=30] [pcm16|opus]
 * Local-machine numbers are indicative only; Cloud Run sizing is measured on staging (S1-11).
 */
const [sessionsArg = '10', secondsArg = '30', codecArg = 'opus'] = process.argv.slice(2);
const sessions = Number(sessionsArg);
const seconds = Number(secondsArg);
const codec = codecArg === 'pcm16' ? 'pcm16' : 'opus';
const port = 8799;
const base = `http://127.0.0.1:${port}`;

const dataDir = await mkdtemp(join(tmpdir(), 'gateway-load-'));
const gateway = spawn(process.execPath, [resolve(import.meta.dirname, 'main.ts')], {
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    APP_ENV: 'local',
    STT_PROVIDER: 'none',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((ok) =>
  gateway.stdout.on('data', (d: Buffer) => {
    if (d.toString().includes('gateway.listening')) ok();
  }),
);

const samples: { cpu: number; rssMb: number }[] = [];
const sampler = setInterval(() => {
  const [cpu, rss] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(gateway.pid)])
    .toString()
    .trim()
    .split(/\s+/)
    .map(Number);
  samples.push({ cpu: cpu ?? 0, rssMb: (rss ?? 0) / 1024 });
}, 1000);

// ~24 kbps Opus = five 60-byte packets per 100 ms; PCM16 = 3200 bytes per 100 ms.
const opusPayload = packOpusFrame(Array.from({ length: 5 }, () => new Uint8Array(60).fill(1)));
const pcmPayload = new Uint8Array(3200);

async function post(path: string): Promise<Record<string, string>> {
  return (await (await fetch(`${base}${path}`, { method: 'POST' })).json()) as Record<
    string,
    string
  >;
}

async function runSession(): Promise<number> {
  const { sessionId = '', streamUrl = '' } = await post('/v1/dev/sessions');
  const { streamToken = '' } = await post(`/v1/dev/sessions/${sessionId}/stream-token`);
  const ws = new WebSocket(streamUrl, ['minutes.v1', `token.${streamToken}`]);
  let acks = 0;
  ws.on('message', (data) => {
    if (String(data).includes('"ack"')) acks += 1;
  });
  await new Promise((ok) => ws.once('open', ok));
  ws.send(
    JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      sessionId,
      resumeFrom: { me: -1, them: -1 },
      format: { codec, sampleRate: 16000, channels: 1, frameMs: 100 },
    }),
  );
  await new Promise((ok) => ws.once('message', ok));
  const started = Date.now();
  for (let seq = 0; seq < seconds * 10; seq++) {
    for (const lane of ['me', 'them'] as Lane[]) {
      const payload = codec === 'opus' ? opusPayload : pcmPayload;
      ws.send(encodeAudioFrame({ lane, seq, captureMs: seq * 100, payload }));
    }
    const wait = started + (seq + 1) * 100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  ws.send(JSON.stringify({ type: 'control', action: 'end', at: seconds * 1000 }));
  await new Promise((ok) => ws.once('close', ok));
  return acks;
}

const acks = await Promise.all(Array.from({ length: sessions }, () => runSession()));
clearInterval(sampler);
const exited = new Promise((ok) => gateway.once('exit', ok));
gateway.kill('SIGTERM');
await exited; // it writes usage files while shutting down
await rm(dataDir, { recursive: true, force: true });

const steady = samples.slice(2);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
console.log(
  JSON.stringify({
    codec,
    sessions,
    seconds,
    avgCpuPercent: +avg(steady.map((s) => s.cpu)).toFixed(1),
    maxCpuPercent: Math.max(...steady.map((s) => s.cpu)),
    maxRssMb: +Math.max(...samples.map((s) => s.rssMb)).toFixed(0),
    cpuPercentPerSession: +(avg(steady.map((s) => s.cpu)) / sessions).toFixed(2),
    acksPerSession: acks,
  }),
);
