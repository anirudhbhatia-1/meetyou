import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

import type { ChunkFrame } from './chunk-store.ts';
import { checkLane, checkVideoPart, videoExtension } from './session-check.ts';

/**
 * Loss check for a recorded session from the local chunk store (S1-11 / M1 exit). Prints counts
 * only. Usage (repo root):
 *   node backend/apps/gateway/src/check-session.ts [sessionId] [--data-dir DIR] [--workspace dev] [--join]
 * Without a session ID it checks the most recently written session. `--join` concatenates each
 * video part's fragments into `video/{partId}.mp4` (or `.webm`) next to them, for playback checks;
 * one MediaRecorder run's fragments form a valid file (ADR-0011 §3.4). The files stay in `.data`.
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : fallback;
};
const dataDir = flag('--data-dir', resolve(import.meta.dirname, '..', '.data'));
const workspace = flag('--workspace', 'dev');
const meetingsDir = join(dataDir, 'ws', workspace, 'meetings');

async function latestSession(): Promise<string> {
  const names = (await readdir(meetingsDir)).filter((n) => n.startsWith('ses_'));
  // ULIDs sort by creation time.
  const latest = names.sort().at(-1);
  if (latest === undefined) throw new Error(`no sessions under ${meetingsDir}`);
  return latest;
}

async function laneFrames(sessionId: string, lane: 'me' | 'them'): Promise<ChunkFrame[]> {
  const dir = join(meetingsDir, sessionId, 'audio', lane);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const frames: ChunkFrame[] = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const manifest = JSON.parse(await readFile(join(dir, name), 'utf8')) as {
      frames: { seq: number; captureMs: number; durationMs?: number }[];
    };
    for (const f of manifest.frames) frames.push({ ...f, durationMs: f.durationMs ?? 100 });
  }
  return frames;
}

async function checkVideo(sessionId: string, join_: boolean): Promise<number> {
  const videoDir = join(meetingsDir, sessionId, 'video');
  let parts: string[];
  try {
    parts = (await readdir(videoDir)).filter((n) => n.startsWith('vp_') && !n.includes('.'));
  } catch {
    console.log('  video: none uploaded');
    return 0;
  }
  let missing = 0;
  for (const partId of parts.sort()) {
    const dir = join(videoDir, partId);
    const names = (await readdir(dir)).filter((n) => /^\d+\.frag$/.test(n));
    const indices = names.map((n) => Number.parseInt(n, 10)).sort((a, b) => a - b);
    const report = checkVideoPart(indices);
    missing += report.missingIndices.length;
    let bytes = 0;
    for (const n of names) bytes += (await stat(join(dir, n))).size;
    console.log(
      `  video ${partId} fragments=${report.fragments} missing=${report.missingIndices.length}` +
        ` size=${(bytes / 1e6).toFixed(1)} MB`,
    );
    if (join_ && indices.length > 0) {
      const chunks = await Promise.all(indices.map((i) => readFile(join(dir, `${i}.frag`))));
      const file = Buffer.concat(chunks);
      const out = join(videoDir, `${partId}.${videoExtension(file.subarray(0, 8))}`);
      await writeFile(out, file);
      console.log(`       joined → ${out}`);
    }
  }
  return missing;
}

const VALUE_FLAGS = new Set(['--data-dir', '--workspace']);
const positional = args.filter(
  (a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1] ?? ''),
);
const sessionId = positional[0] ?? (await latestSession());
const minutes = (ms: number) => (ms / 60_000).toFixed(2);

console.log(`session ${sessionId}`);
let lost = 0;
for (const lane of ['me', 'them'] as const) {
  const r = checkLane(await laneFrames(sessionId, lane));
  lost += r.missingSeqs.length;
  console.log(
    `  ${lane.padEnd(4)} frames=${r.frames} seq=${r.firstSeq}..${r.lastSeq} audio=${minutes(r.audioMs)} min` +
      ` span=${minutes(r.spanMs)} min missing=${r.missingSeqs.length} duplicates=${r.duplicateSeqs.length}` +
      ` gaps=${r.gaps.length} (${minutes(r.gaps.reduce((n, g) => n + g.lengthMs, 0))} min)`,
  );
  if (r.missingSeqs.length > 0)
    console.log(`       first missing: ${r.missingSeqs.slice(0, 10).join(', ')}`);
}
try {
  const usage = JSON.parse(await readFile(join(meetingsDir, sessionId, 'usage.json'), 'utf8')) as {
    codec: string;
    connections: number;
    bytesStored: number;
    stt: { provider: string | null; audioMs: { me: number; them: number } };
    segments?: { me: number; them: number; echoFlagged: number; echoLate: number };
    estimatedCostUsd: number;
  };
  console.log(
    `  usage codec=${usage.codec} connections=${usage.connections} stored=${(usage.bytesStored / 1e6).toFixed(1)} MB` +
      ` stt=${usage.stt.provider ?? 'none'} ${minutes(usage.stt.audioMs.me + usage.stt.audioMs.them)} min` +
      ` est=$${usage.estimatedCostUsd.toFixed(4)}`,
  );
  if (usage.segments !== undefined) {
    const s = usage.segments;
    console.log(
      `  segments me=${s.me} them=${s.them} echo: flagged=${s.echoFlagged} late=${s.echoLate}` +
        (s.me > 0 ? ` (${(((s.echoFlagged + s.echoLate) / s.me) * 100).toFixed(0)}% of me)` : ''),
    );
  }
} catch {
  console.log('  usage: none written yet');
}
const videoMissing = await checkVideo(sessionId, args.includes('--join'));
console.log(lost === 0 ? 'RESULT: no audio loss' : `RESULT: ${lost} frames missing`);
if (videoMissing > 0) console.log(`RESULT: ${videoMissing} video fragments missing`);
process.exitCode = lost === 0 && videoMissing === 0 ? 0 : 1;
