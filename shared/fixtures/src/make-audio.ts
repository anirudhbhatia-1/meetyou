import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { STANDUP_DURATION_MS, STANDUP_HINGLISH } from './script.ts';

/**
 * Makes synthetic audio for the standup script (S2-13): each utterance spoken by a macOS TTS
 * voice (`say`), placed at its script time on its lane, as 16 kHz mono WAV per lane — the shape
 * the capture lanes produce. Output goes to `shared/fixtures/audio/` (gitignored: no audio is
 * committed, AGENTS §8). Needs macOS `say` and `ffmpeg`.
 *   pnpm --filter @meetyou/fixtures audio
 */
const out = resolve(import.meta.dirname, '..', 'audio');
const tmp = join(out, 'tmp');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

for (const lane of ['me', 'them'] as const) {
  const lines = STANDUP_HINGLISH.map((u, i) => ({ u, i })).filter(({ u }) => u.lane === lane);
  const inputs: string[] = [];
  const delays: string[] = [];
  for (const { u, i } of lines) {
    const aiff = join(tmp, `${i}.aiff`);
    execFileSync('say', ['-v', u.voice, '-o', aiff, u.text]);
    inputs.push('-i', aiff);
    delays.push(`[${inputs.length / 2 - 1}:a]adelay=${u.startMs}:all=1[d${inputs.length / 2 - 1}]`);
  }
  const mix = lines.map((_, k) => `[d${k}]`).join('');
  const target = join(out, `standup-${lane}.wav`);
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputs,
    '-filter_complex',
    `${delays.join(';')};${mix}amix=inputs=${lines.length}:normalize=0,apad=whole_dur=${STANDUP_DURATION_MS / 1000}[out]`,
    '-map',
    '[out]',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-t',
    String(STANDUP_DURATION_MS / 1000),
    target,
  ]);
  console.log(`wrote ${target}`);
}
rmSync(tmp, { recursive: true, force: true });
process.exitCode = 0;
