import type { Lane } from '../messages.ts';

export interface TranscriptLine {
  /** Stable React key: finals are numbered in arrival order. */
  key: number;
  lane: Lane;
  /** Diarized cluster of a `them` line (e.g. "spk_2"), null when unknown. */
  speaker: string | null;
  startMs: number;
  text: string;
}

export interface TranscriptView {
  finals: TranscriptLine[];
  /** Latest interim per lane; replaced in place by that lane's next final (FR-LIV-02). */
  interim: Partial<Record<Lane, TranscriptLine>>;
  nextKey: number;
}

/** The panel keeps the live tail only; the full transcript is in the library (§12.5). */
export const MAX_LIVE_LINES = 500;

export const EMPTY_TRANSCRIPT: TranscriptView = { finals: [], interim: {}, nextKey: 0 };

export function applyTranscript(
  view: TranscriptView,
  update: { final: boolean; lane: Lane; text: string; startMs: number; speaker: string | null },
): TranscriptView {
  const line: TranscriptLine = {
    key: view.nextKey,
    lane: update.lane,
    speaker: update.speaker,
    startMs: update.startMs,
    text: update.text,
  };
  if (!update.final) {
    return {
      ...view,
      interim: { ...view.interim, [update.lane]: line },
      nextKey: view.nextKey + 1,
    };
  }
  const interim: TranscriptView['interim'] =
    update.lane === 'me' ? { them: view.interim.them } : { me: view.interim.me };
  const finals = [...view.finals, line];
  return {
    finals: finals.length > MAX_LIVE_LINES ? finals.slice(-MAX_LIVE_LINES) : finals,
    interim,
    nextKey: view.nextKey + 1,
  };
}

/** Finals then interims, in time order, as the list shows them. */
export function visibleLines(view: TranscriptView): (TranscriptLine & { final: boolean })[] {
  const interims = Object.values(view.interim)
    .filter((line) => line !== undefined)
    .sort((a, b) => a.startMs - b.startMs)
    .map((line) => ({ ...line, final: false }));
  return [...view.finals.map((line) => ({ ...line, final: true })), ...interims];
}
