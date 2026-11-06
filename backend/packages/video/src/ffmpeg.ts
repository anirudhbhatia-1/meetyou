import { execFile } from 'node:child_process';

/** Paths of the ffmpeg binaries: the worker image has them on PATH (ADR-0011 §3.4). */
export interface FfmpegTools {
  ffmpeg: string;
  ffprobe: string;
}

export const DEFAULT_TOOLS: FfmpegTools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

/** An hour of 720p copy-remux takes seconds; a multi-part re-encode a few minutes. */
const TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Runs a binary with an argument list (no shell, so no quoting or injection). stderr is kept for the
 * error message's tail only; it can name files but never holds content we log elsewhere.
 */
export function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`${command} failed: ${stderr.slice(-400)}`, { cause: error }));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export interface Probe {
  durationMs: number;
  video: { codec: string; width: number; height: number } | null;
  audio: { codec: string } | null;
}

/** Container duration and the first video and audio streams. */
export async function probe(tools: FfmpegTools, path: string): Promise<Probe> {
  const out = await run(tools.ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height',
    '-of',
    'json',
    path,
  ]);
  const parsed = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
  };
  const streams = parsed.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const seconds = Number(parsed.format?.duration);
  return {
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
    video:
      v === undefined
        ? null
        : { codec: v.codec_name ?? '', width: v.width ?? 0, height: v.height ?? 0 },
    audio: a === undefined ? null : { codec: a.codec_name ?? '' },
  };
}
