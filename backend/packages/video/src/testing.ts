import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { run } from './ffmpeg.ts';

/** Test helpers (synthetic media only, made by ffmpeg's test sources). */

export const hasFfmpeg = (): boolean => spawnSync('ffmpeg', ['-version']).status === 0;

/** Top-level MP4 boxes: [type, start, end]. */
export function boxes(bytes: Uint8Array): [string, number, number][] {
  const out: [string, number, number][] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at + 8 <= bytes.length;) {
    const size = view.getUint32(at);
    const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
    out.push([type, at, at + size]);
    if (size < 8) break;
    at += size;
  }
  return out;
}

/**
 * A fragmented MP4 cut like MediaRecorder output (ADR-0011 §3.2): fragment 0 is the init segment
 * plus the first media fragment, then one fragment per moof+mdat pair (2 s here, 10 s in the app).
 */
export async function synthFragments(
  dir: string,
  name: string,
  seconds: number,
  color: string,
): Promise<Uint8Array[]> {
  const path = join(dir, `${name}.mp4`);
  await run('ffmpeg', [
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=640x360:r=15:d=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-g',
    '30',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration',
    '2000000',
    path,
  ]);
  const bytes = new Uint8Array(await readFile(path));
  const list = boxes(bytes);
  const moov = list.findIndex(([t]) => t === 'moov');
  const fragments: Uint8Array[] = [];
  let start = 0;
  for (let i = moov + 1; i < list.length; i++) {
    const [type, , end] = list[i] ?? ['', 0, 0];
    if (type === 'mdat') {
      fragments.push(bytes.slice(start, end));
      start = end;
    }
  }
  return fragments;
}
