/**
 * Object names (ARCHITECTURE §11.4, ADR-0011 §3.5). One prefix per meeting, so retention and
 * deletion remove a meeting with one prefix walk:
 *   ws/{workspaceId}/meetings/{meetingId}/audio/{lane}/{chunkStartMs}.{opus|pcm16}  (+ .json manifest)
 *   ws/{workspaceId}/meetings/{meetingId}/video/{partId}/{index}.frag  (+ part.json; temporary)
 *   ws/{workspaceId}/meetings/{meetingId}/video/playback.mp4 · video/poster.jpg
 *   ws/{workspaceId}/meetings/{meetingId}/usage.json · segments/{batchId}.jsonl
 */
const ID = /^[A-Za-z0-9_-]{1,80}$/;

function id(value: string): string {
  if (!ID.test(value)) throw new Error('invalid storage id');
  return value;
}

export function meetingPrefix(workspaceId: string, meetingId: string): string {
  return `ws/${id(workspaceId)}/meetings/${id(meetingId)}/`;
}

export function audioPrefix(workspaceId: string, meetingId: string, lane: 'me' | 'them'): string {
  return `${meetingPrefix(workspaceId, meetingId)}audio/${lane}/`;
}

/** Zero-padded start time: names sort in time order, so the newest manifest is the last key. */
export function audioChunkBase(
  workspaceId: string,
  meetingId: string,
  lane: 'me' | 'them',
  startMs: number,
): string {
  if (!Number.isInteger(startMs) || startMs < 0) throw new Error('invalid chunk start');
  return `${audioPrefix(workspaceId, meetingId, lane)}${String(startMs).padStart(10, '0')}`;
}

export function videoPrefix(workspaceId: string, meetingId: string): string {
  return `${meetingPrefix(workspaceId, meetingId)}video/`;
}

export function videoFragmentKey(
  workspaceId: string,
  meetingId: string,
  partId: string,
  index: number,
): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('invalid fragment index');
  return `${videoPrefix(workspaceId, meetingId)}${id(partId)}/${index}.frag`;
}

export function videoPartInfoKey(workspaceId: string, meetingId: string, partId: string): string {
  return `${videoPrefix(workspaceId, meetingId)}${id(partId)}/part.json`;
}

export type VideoFileName = 'playback.mp4' | 'poster.jpg';

export function videoFileKey(workspaceId: string, meetingId: string, name: VideoFileName): string {
  return `${videoPrefix(workspaceId, meetingId)}${name}`;
}

export function usageKey(workspaceId: string, meetingId: string): string {
  return `${meetingPrefix(workspaceId, meetingId)}usage.json`;
}

export function segmentsKey(workspaceId: string, meetingId: string, batchId: string): string {
  return `${meetingPrefix(workspaceId, meetingId)}segments/${id(batchId)}.jsonl`;
}
