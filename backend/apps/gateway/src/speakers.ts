import type { SttResult, SttWord } from '@meetyou/providers';

export interface SpeakerRun {
  speaker: number | undefined;
  text: string;
  startMs: number;
  endMs: number;
  words: SttWord[];
}

/**
 * Splits a final result into runs of consecutive words by the same diarized speaker, so each
 * stored segment has one speaker (FR-SPK-02). Without speaker labels the result stays whole.
 */
export function splitBySpeaker(result: SttResult): SpeakerRun[] {
  const words = result.words ?? [];
  const speakers = new Set(words.map((w) => w.speaker));
  if (words.length === 0 || speakers.size <= 1) {
    return [
      {
        speaker: words[0]?.speaker,
        text: result.text,
        startMs: result.startMs,
        endMs: result.endMs,
        words,
      },
    ];
  }
  const runs: SpeakerRun[] = [];
  for (const word of words) {
    const last = runs.at(-1);
    if (last !== undefined && last.speaker === word.speaker) {
      last.words.push(word);
      last.text += ` ${word.text}`;
      last.endMs = word.endMs;
    } else {
      runs.push({
        speaker: word.speaker,
        text: word.text,
        startMs: word.startMs,
        endMs: word.endMs,
        words: [word],
      });
    }
  }
  return runs;
}

/** Cluster ID stored on segments; "Speaker N" in the UI until a name is resolved (FR-SPK-03). */
export function clusterId(speaker: number | undefined): string | undefined {
  return speaker === undefined ? undefined : `spk_${speaker + 1}`;
}
