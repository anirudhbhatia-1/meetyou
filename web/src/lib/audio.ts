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

let stopOther: (() => void) | null = null;

/**
 * Only one player sounds at a time on the page (DESIGN §6.19): the transcript and the citation card
 * each have a player, and clicking one used to leave the other playing (2026-11-09 audit). A player
 * calls this when it starts; the previous one is paused.
 */
export function claimPlayback(stop: () => void): void {
  if (stopOther !== null && stopOther !== stop) stopOther();
  stopOther = stop;
}

/** Lanes fetched once per meeting for every player on the page, released with the last one. */
const laneCache = new Map<
  string,
  { users: number; lanes: Map<'me' | 'them', Promise<LaneAudio | null>> }
>();

function useLaneCache(meetingId: string) {
  const entry = useRef<{ lanes: Map<'me' | 'them', Promise<LaneAudio | null>> } | null>(null);
  useEffect(() => {
    let cached = laneCache.get(meetingId);
    if (cached === undefined) {
      cached = { users: 0, lanes: new Map() };
      laneCache.set(meetingId, cached);
    }
    cached.users += 1;
    entry.current = cached;
    const mine = cached;
    return () => {
      mine.users -= 1;
      if (mine.users > 0) return;
      laneCache.delete(meetingId);
      for (const lane of mine.lanes.values()) {
        void lane.then((l) => {
          if (l !== null) URL.revokeObjectURL(l.url);
        });
      }
    };
  }, [meetingId]);
  return entry;
}

/**
 * Audio playback for meetings without video (DESIGN §12.5–§12.6): each lane is fetched once per
 * page (owner only, through the API) and played from a blob URL; times map through the lane's
 * spans. Concurrent first clicks share one download.
 */
export function useMeetingAudio(api: LibraryApi, meetingId: string): MeetingAudio {
  const element = useRef<HTMLAudioElement | null>(null);
  const lanes = useRef(new Map<'me' | 'them', LaneAudio | null>());
  const shared = useLaneCache(meetingId);
  const stop = useRef(() => element.current?.pause());
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
      // Blob URLs belong to the shared cache, which revokes them with its last user.
      loaded.clear();
    };
  }, [meetingId]);

  return {
    async playFrom(lane, at) {
      const audio = element.current;
      if (audio === null) return false;
      if (!lanes.current.has(lane)) {
        const cache = shared.current?.lanes;
        let pending = cache?.get(lane);
        if (pending === undefined) {
          pending = api.getAudio(meetingId, lane).catch(() => null);
          cache?.set(lane, pending);
        }
        lanes.current.set(lane, await pending);
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
      claimPlayback(stop.current);
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
