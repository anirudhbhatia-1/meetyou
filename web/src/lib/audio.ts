import { useEffect, useRef, useState } from 'react';

import type { LaneAudio, LibraryApi } from '../api/types.ts';

type Span = LaneAudio['spans'][number];

/**
 * Meeting time → position in the lane's file. A time inside a pause (nothing recorded) starts at
 * the next recorded stretch; past the end there is nothing to play.
 */
export function sessionToFile(spans: readonly Span[], sessionMs: number): number | null {
  for (const s of spans) {
    if (sessionMs < s.sessionMs) return s.fileMs;
    if (sessionMs < s.sessionMs + s.durationMs) return s.fileMs + (sessionMs - s.sessionMs);
  }
  return null;
}

/** Position in the file → meeting time (for highlighting the line being played). */
export function fileToSession(spans: readonly Span[], fileMs: number): number {
  for (const s of spans) {
    if (fileMs < s.fileMs + s.durationMs) return s.sessionMs + Math.max(0, fileMs - s.fileMs);
  }
  const last = spans.at(-1);
  return last === undefined ? fileMs : last.sessionMs + last.durationMs;
}

export interface MeetingAudio {
  /** Plays a lane from a meeting time; resolves false when the recording is not available. */
  playFrom(lane: 'me' | 'them', sessionMs: number): Promise<boolean>;
  pause(): void;
  playing: boolean;
  /** Meeting time of the playhead, while playing. */
  sessionMs: number | null;
  /** True once a lane turned out to be deleted (retention) or missing. */
  unavailable: boolean;
}

/**
 * Audio playback for meetings without video (DESIGN §12.5–§12.6): each lane is fetched once (owner
 * only, through the API) and played from a blob URL; times map through the lane's spans.
 */
export function useMeetingAudio(api: LibraryApi, meetingId: string): MeetingAudio {
  const element = useRef<HTMLAudioElement | null>(null);
  const lanes = useRef(new Map<'me' | 'them', LaneAudio | null>());
  const current = useRef<'me' | 'them' | null>(null);
  const [playing, setPlaying] = useState(false);
  const [sessionMs, setSessionMs] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const audio = new Audio();
    element.current = audio;
    const onTime = () => {
      const lane = current.current === null ? undefined : lanes.current.get(current.current);
      if (lane != null) setSessionMs(fileToSession(lane.spans, audio.currentTime * 1000));
    };
    const onPlay = () => setPlaying(true);
    const onStop = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onStop);
    audio.addEventListener('ended', onStop);
    const loaded = lanes.current;
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onStop);
      audio.removeEventListener('ended', onStop);
      for (const lane of loaded.values()) if (lane !== null) URL.revokeObjectURL(lane.url);
      loaded.clear();
    };
  }, [meetingId]);

  return {
    async playFrom(lane, at) {
      const audio = element.current;
      if (audio === null) return false;
      if (!lanes.current.has(lane)) {
        lanes.current.set(lane, await api.getAudio(meetingId, lane).catch(() => null));
      }
      const loaded = lanes.current.get(lane) ?? null;
      const fileMs = loaded === null ? null : sessionToFile(loaded.spans, at);
      if (loaded === null || fileMs === null) {
        setUnavailable(loaded === null);
        return false;
      }
      if (current.current !== lane) {
        audio.src = loaded.url;
        current.current = lane;
      }
      audio.currentTime = fileMs / 1000;
      await audio.play().catch(() => undefined);
      return true;
    },
    pause() {
      element.current?.pause();
    },
    playing,
    sessionMs: playing ? sessionMs : null,
    unavailable,
  };
}
