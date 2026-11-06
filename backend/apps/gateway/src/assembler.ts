import { LanguageTag, newUlid, Segment, type Lane } from '@meetyou/contracts';
import { asProvidedPolicy, type DisplayTextPolicy } from '@meetyou/hinglish';
import type { SttResult } from '@meetyou/providers';

import { EchoDetector } from './echo.ts';
import { clusterId, splitBySpeaker } from './speakers.ts';
import type { StreamTimeline } from './timeline.ts';

/**
 * Transcript assembler (S2-05, ARCHITECTURE §8.1): turns final STT results into stored segments.
 * 1. provider time → session clock (`StreamTimeline`);
 * 2–3. display text through the policy (transliteration and spelling; `rawText` keeps the original);
 * 4. provisional speaker: `them` gets the provider's diarization cluster;
 * 5. ULID segment IDs;
 * 7. probable echo of `them` in the `me` lane is flagged, not deleted.
 * The display policy is `as_provided` by default (Anirudh, 2026-11-06); `roman_rules` turns on D-01.
 */
export class TranscriptAssembler {
  readonly #workspaceId: string;
  readonly #meetingId: string;
  readonly #display: DisplayTextPolicy;
  readonly #echo = new EchoDetector();
  readonly #newId: () => string;

  constructor(options: {
    workspaceId: string;
    meetingId: string;
    display?: DisplayTextPolicy;
    /** Tests pass a deterministic ID source. */
    newId?: () => string;
  }) {
    this.#workspaceId = options.workspaceId;
    this.#meetingId = options.meetingId;
    this.#display = options.display ?? asProvidedPolicy();
    this.#newId = options.newId ?? (() => `seg_${newUlid()}`);
  }

  /** Interim text in the same script as finals, so lines never flip script (DESIGN §8.6). */
  interimText(text: string): string {
    return this.#display.toDisplay(text);
  }

  /**
   * One segment per diarized speaker run of a final result (FR-SPK-02; `me` is never diarized).
   * Runs that do not validate are returned in `invalid` (counted by the caller, never logged).
   */
  finalSegments(
    lane: Lane,
    timeline: StreamTimeline,
    result: SttResult,
  ): { segments: Segment[]; echoFlags: { flag: boolean; late: boolean }[]; invalid: number } {
    const segments: Segment[] = [];
    const echoFlags: { flag: boolean; late: boolean }[] = [];
    let invalid = 0;
    for (const run of splitBySpeaker(result)) {
      const startMs = timeline.toSessionMs(run.startMs);
      const endMs = Math.max(startMs, timeline.toSessionMs(run.endMs));
      const echo = this.#echo.check(lane, startMs, endMs, run.text);
      const speakerClusterId = lane === 'them' ? clusterId(run.speaker) : undefined;
      const parsed = Segment.safeParse({
        id: this.#newId(),
        workspaceId: this.#workspaceId,
        meetingId: this.#meetingId,
        lane,
        // TODO(S3-04): cluster IDs restart with each provider stream; batch resolution unifies them.
        ...(speakerClusterId !== undefined ? { speakerClusterId } : {}),
        startMs,
        endMs,
        text: this.#display.toDisplay(run.text),
        rawText: run.text,
        language: languageTag(result.language),
        source: 'live',
        words: run.words.map((w) => ({
          text: w.text,
          startMs: timeline.toSessionMs(w.startMs),
          endMs: timeline.toSessionMs(w.endMs),
          ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
        })),
        flags: echo.flag ? ['echo'] : [],
      });
      echoFlags.push(echo);
      if (parsed.success) segments.push(parsed.data);
      else invalid += 1;
    }
    return { segments, echoFlags, invalid };
  }
}

function languageTag(language: string | undefined): string {
  const tag = language?.toLowerCase();
  return tag !== undefined && LanguageTag.safeParse(tag).success ? tag : 'und';
}
