import { open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_TOOLS, probe, run, type FfmpegTools } from './ffmpeg.ts';

/** Part timing recorded from the extension's `video.part_started` / `video.part_stopped` events. */
export interface PartTiming {
  partId: string;
  mimeType: 'video/mp4' | 'video/webm';
  /** Session-clock start (ARCHITECTURE §5.5). */
  startMs: number;
  /** Fragments the part produced, once it stopped; unknown for a part still recording. */
  fragments?: number;
}

/**
 * Where uploaded fragments are read and the finalized files written. The gateway's chunk store
 * (local disk now, Cloud Storage in staging) implements it with the ARCHITECTURE §11.4 layout.
 */
export interface VideoStore {
  listVideo(
    workspaceId: string,
    meetingId: string,
  ): Promise<{ partId: string; indices: number[] }[]>;
  listVideoPartInfo(workspaceId: string, meetingId: string): Promise<PartTiming[]>;
  readVideoFragment(
    workspaceId: string,
    meetingId: string,
    partId: string,
    index: number,
  ): Promise<Uint8Array>;
  /** Stores `video/playback.mp4` or `video/poster.jpg` from a local file. */
  putVideoFile(
    workspaceId: string,
    meetingId: string,
    name: 'playback.mp4' | 'poster.jpg',
    sourcePath: string,
  ): Promise<{ storageKey: string; bytes: number }>;
  /** Removes the temporary fragments once the playback file is stored (ADR-0011 §3.4). */
  deleteVideoFragments(workspaceId: string, meetingId: string): Promise<void>;
}

/** Fragments are 10 s (ADR-0011 §3.2). */
const FRAGMENT_MS = 10_000;
/** One output size, so parts recorded at different qualities join (data saver switches, §3.2). */
const OUTPUT = { width: 1280, height: 720, fps: 15 };

export interface PartPlan {
  partId: string;
  startMs: number;
  /** Indices present, from 0; a part without fragment 0 (the init segment) cannot play. */
  indices: number[];
  /** Expected but absent (holes, or a tail still uploading). */
  missing: number[];
  playable: boolean;
}

/**
 * Lines parts up on the session clock. Timing comes from the part events; a part without them
 * (older recording, lost event) is placed right after the previous one.
 */
export function planParts(
  stored: readonly { partId: string; indices: number[] }[],
  timing: readonly PartTiming[],
): PartPlan[] {
  const byId = new Map(timing.map((t) => [t.partId, t]));
  const plans: PartPlan[] = [];
  let nextStart = 0;
  for (const part of [...stored].sort((a, b) => {
    const ta = byId.get(a.partId)?.startMs ?? Number.MAX_SAFE_INTEGER;
    const tb = byId.get(b.partId)?.startMs ?? Number.MAX_SAFE_INTEGER;
    return ta - tb || a.partId.localeCompare(b.partId);
  })) {
    const info = byId.get(part.partId);
    const indices = [...part.indices].sort((a, b) => a - b);
    const last = Math.max(indices.at(-1) ?? -1, (info?.fragments ?? 0) - 1);
    const present = new Set(indices);
    const missing = Array.from({ length: last + 1 }, (_, i) => i).filter((i) => !present.has(i));
    const startMs = info?.startMs ?? nextStart;
    plans.push({ partId: part.partId, startMs, indices, missing, playable: present.has(0) });
    nextStart = startMs + (last + 1) * FRAGMENT_MS;
  }
  return plans;
}

/** True when every stopped part has all its fragments (finalize can run, ADR-0011 §3.4). */
export function uploadsComplete(
  stored: readonly { partId: string; indices: number[] }[],
  timing: readonly PartTiming[],
): boolean {
  const byId = new Map(stored.map((p) => [p.partId, new Set(p.indices)]));
  return timing.every((t) => {
    if (t.fragments === undefined) return false;
    const have = byId.get(t.partId) ?? new Set<number>();
    return Array.from({ length: t.fragments }, (_, i) => i).every((i) => have.has(i));
  });
}

export interface FinalizeResult {
  storageKey: string;
  posterKey: string;
  bytes: number;
  durationMs: number;
  /** Session-clock time of the file's first frame: the player maps t to `startMs + t`. */
  startMs: number;
  parts: PartPlan[];
  fragments: number;
}

/**
 * `video.finalize` (ADR-0011 §3.4): join each part's fragments, remux to MP4 (H.264 + AAC,
 * faststart; video copied when already H.264, re-encoded for the VP9 fallback), fill the time
 * between parts with the last frame and silence so one file follows the session clock, and write
 * `playback.mp4` and `poster.jpg`. Fragments are deleted only by the caller, after it recorded the
 * result. Returns null when nothing is playable.
 */
export async function finalizeVideo(options: {
  store: VideoStore;
  workspaceId: string;
  meetingId: string;
  /** Scratch directory for this run; the caller creates and removes it. */
  workDir: string;
  tools?: FfmpegTools;
}): Promise<FinalizeResult | null> {
  const { store, workspaceId, meetingId, workDir } = options;
  const tools = options.tools ?? DEFAULT_TOOLS;
  const stored = await store.listVideo(workspaceId, meetingId);
  const plans = planParts(stored, await store.listVideoPartInfo(workspaceId, meetingId));
  const playable = plans.filter((p) => p.playable);
  if (playable.length === 0) return null;

  // 1. Each part: fragments joined in order, then remuxed to MP4 (duration becomes known).
  const parts: JoinPart[] = [];
  for (const [i, plan] of playable.entries()) {
    const joined = join(workDir, `part-${i}.raw`);
    const handle = await open(joined, 'w');
    try {
      for (const index of plan.indices) {
        await handle.write(
          await store.readVideoFragment(workspaceId, meetingId, plan.partId, index),
        );
      }
    } finally {
      await handle.close();
    }
    const source = await probe(tools, joined);
    const path = join(workDir, `part-${i}.mp4`);
    await run(tools.ffmpeg, [
      '-hide_banner',
      '-y',
      '-i',
      joined,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      ...(source.video?.codec === 'h264'
        ? ['-c:v', 'copy']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p']),
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      path,
    ]);
    await rm(joined, { force: true });
    const remuxed = await probe(tools, path);
    parts.push({ plan, path, durationMs: remuxed.durationMs, hasAudio: remuxed.audio !== null });
  }

  // 2. One file on the session clock.
  const playback = join(workDir, 'playback.mp4');
  const first = parts[0];
  if (first === undefined) return null;
  if (parts.length === 1) {
    await run(tools.ffmpeg, [
      '-hide_banner',
      '-y',
      '-i',
      first.path,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      playback,
    ]);
  } else {
    await run(tools.ffmpeg, ['-hide_banner', '-y', ...joinArgs(parts), playback]);
  }

  // 3. Poster from early in the meeting.
  const durationMs = (await probe(tools, playback)).durationMs;
  const poster = join(workDir, 'poster.jpg');
  const at = Math.min(1, durationMs / 2000).toFixed(3);
  await run(tools.ffmpeg, [
    '-hide_banner',
    '-y',
    '-ss',
    at,
    '-i',
    playback,
    '-frames:v',
    '1',
    '-q:v',
    '4',
    poster,
  ]);

  const stored1 = await store.putVideoFile(workspaceId, meetingId, 'playback.mp4', playback);
  const stored2 = await store.putVideoFile(workspaceId, meetingId, 'poster.jpg', poster);
  return {
    storageKey: stored1.storageKey,
    posterKey: stored2.storageKey,
    bytes: (await stat(playback)).size,
    durationMs,
    startMs: first.plan.startMs,
    parts: plans,
    fragments: plans.reduce((n, p) => n + p.indices.length, 0),
  };
}

/**
 * ffmpeg arguments that scale every part to one size and frame rate, pad each part (except the
 * last) with its last frame and silence up to the next part's start, and concatenate.
 */
export interface JoinPart {
  plan: { startMs: number };
  path: string;
  durationMs: number;
  /** A part recorded without the audio mix gets generated silence instead. */
  hasAudio: boolean;
}

export function joinArgs(parts: readonly JoinPart[]): string[] {
  const inputs = parts.flatMap((p) => ['-i', p.path]);
  // Silence sources for parts without audio come after the part inputs.
  const silence = new Map<number, number>();
  parts.forEach((p, i) => {
    if (p.hasAudio) return;
    silence.set(i, parts.length + silence.size);
    inputs.push(
      '-f',
      'lavfi',
      '-t',
      (p.durationMs / 1000).toFixed(3),
      '-i',
      'anullsrc=r=48000:cl=stereo',
    );
  });
  const { width, height, fps } = OUTPUT;
  const chains: string[] = [];
  parts.forEach((part, i) => {
    const next = parts[i + 1];
    const durS = part.durationMs / 1000;
    const gapS =
      next === undefined
        ? 0
        : Math.max(0, (next.plan.startMs - part.plan.startMs - part.durationMs) / 1000);
    chains.push(
      `[${i}:v]trim=0:${durS.toFixed(3)},setpts=PTS-STARTPTS,` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,` +
        `tpad=stop_mode=clone:stop_duration=${gapS.toFixed(3)}[v${i}]`,
      `[${silence.get(i) ?? i}:a]atrim=0:${durS.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,` +
        `aformat=channel_layouts=stereo,apad=whole_dur=${(durS + gapS).toFixed(3)}[a${i}]`,
    );
  });
  const labels = parts.map((_, i) => `[v${i}][a${i}]`).join('');
  chains.push(`${labels}concat=n=${parts.length}:v=1:a=1[v][a]`);
  return [
    ...inputs,
    '-filter_complex',
    chains.join(';'),
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
  ];
}
