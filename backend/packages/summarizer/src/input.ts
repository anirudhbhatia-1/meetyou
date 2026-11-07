import type { Note, Segment } from '@meetyou/contracts';

import type { TemplateId } from './templates.ts';

/** What one summary is made from (PRD §14.1). Built by the pipeline (S3-03) from stored rows. */
export interface SummaryParticipant {
  id: string;
  name: string;
  isSelf: boolean;
}

export interface SummarySegment {
  id: string;
  startMs: number;
  endMs: number;
  /** Display name already resolved by the caller (the user's name on `me`, a speaker on `them`). */
  speaker: string;
  text: string;
  /** Probable echo of the other lane (§8.1 step 7): never shown to the model. */
  echo: boolean;
}

export type SummaryLanguage = 'english' | 'hindi' | 'hinglish';

/** The recording itself: what both summaries and answers are built from. */
export type MeetingData = Pick<SummaryInput, 'meeting' | 'participants' | 'notes' | 'segments'>;

export interface SummaryInput {
  meeting: {
    title: string | null;
    /** The meeting's local date, YYYY-MM-DD: due dates are resolved against it (S3-02). */
    date: string;
    durationMs: number;
    /** Wall-clock start and end, already formatted in the user's time zone ("14:03 IST"). */
    startedAt?: string;
    endedAt?: string;
  };
  participants: SummaryParticipant[];
  notes: Note[];
  segments: SummarySegment[];
  template: TemplateId;
  language: SummaryLanguage;
}

/**
 * Stored segments as the summarizer sees them: the user's own lane is named after them, a remote
 * speaker by name when known, else by diarization cluster ("Speaker 2").
 */
export function summarySegments(segments: readonly Segment[], selfName: string): SummarySegment[] {
  const clusters = new Map<string, number>();
  return segments.map((s) => {
    let speaker = selfName;
    if (s.lane === 'them') {
      if (s.speakerName !== undefined) {
        speaker = s.speakerName;
      } else {
        const cluster = s.speakerClusterId ?? 'unknown';
        if (!clusters.has(cluster)) clusters.set(cluster, clusters.size + 1);
        speaker = `Speaker ${clusters.get(cluster)}`;
      }
    }
    return {
      id: s.id,
      startMs: s.startMs,
      endMs: s.endMs,
      speaker,
      text: s.text,
      echo: s.flags.includes('echo'),
    };
  });
}
