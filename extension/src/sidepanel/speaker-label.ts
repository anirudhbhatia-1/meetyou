import type { Lane } from '../messages.ts';

export interface ParticipantName {
  displayName: string;
  isSelf: boolean;
}

const MAX_NAME = 200;

/**
 * Participants from the Meet adapter (`meet.state-changed` or the `meet.get-state` reply). DOM
 * text is untrusted: only bounded strings pass, and callers render them as text, never HTML.
 */
export function parseParticipants(value: unknown): ParticipantName[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const metadata = (value as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const list = (metadata as { participants?: unknown }).participants;
  if (!Array.isArray(list)) return null;
  const out: ParticipantName[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const { displayName, isSelf } = item as { displayName?: unknown; isSelf?: unknown };
    if (typeof displayName !== 'string' || displayName.trim() === '') continue;
    out.push({ displayName: displayName.trim().slice(0, MAX_NAME), isSelf: isSelf === true });
  }
  return out;
}

/**
 * Display name for a transcript line (PRD FR-SPK-01..03, provisional until sign-in and S3-04):
 * - `me`: the Meet "(You)" participant; S2 replaces it with the signed-in user's name.
 * - `them` on a 1:1 call: the only other participant (FR-SPK-03's 1:1 case).
 * - `them` otherwise: "Speaker N" from the diarized cluster; naming group calls needs Meet's
 *   active-speaker signal (S1-08) aligned in S3-04.
 */
export function speakerLabel(
  lane: Lane,
  cluster: string | null,
  participants: readonly ParticipantName[],
): string {
  if (lane === 'me') return participants.find((p) => p.isSelf)?.displayName ?? 'Me';
  const remote = participants.filter((p) => !p.isSelf);
  const only = remote.length === 1 ? remote[0] : undefined;
  if (only !== undefined) return only.displayName;
  const n = cluster === null ? undefined : /^spk_(\d+)$/.exec(cluster)?.[1];
  return n === undefined ? 'Them' : `Speaker ${n}`;
}
