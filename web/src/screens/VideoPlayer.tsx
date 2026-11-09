import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import type { VideoPlaybackResponse } from '../api/types.ts';
import { Button, Icon, SkeletonRows } from '@meetyou/ui';
import { useApi } from '../lib/api-context.ts';
import { formatClock } from '../lib/format.ts';

export interface PlayerHandle {
  /** Seeks to a moment on the session clock (segment times) and plays (DESIGN §12.5). */
  playFrom(sessionMs: number): void;
  pause(): void;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

/**
 * DESIGN §6.19 video player over the finalized playback file. The signed URL is short-lived, so a
 * load error asks the API for a fresh one once. Positions convert to the session clock with
 * `VideoPlaybackResponse.startMs` (ARCHITECTURE §5.5).
 */
export function VideoPlayer({
  meetingId,
  ref,
  startAt = null,
  onSessionTime,
  onPlayingChange,
  compact = false,
}: {
  meetingId: string;
  ref?: Ref<PlayerHandle>;
  /** Session time to open at ("Play from" on the Notes tab). */
  startAt?: number | null;
  onSessionTime?: (sessionMs: number | null) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Inside the citation card (DESIGN §12.6): no speed or download control. */
  compact?: boolean;
}) {
  const api = useApi();
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [playback, setPlayback] = useState<VideoPlaybackResponse | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [downloading, setDownloading] = useState(false);
  const retried = useRef(false);
  const pendingSeek = useRef<number | null>(null);

  const load = useCallback(() => {
    api.getVideo(meetingId).then(
      (p) => {
        if (p !== null && startAt !== null && pendingSeek.current === null) {
          pendingSeek.current = Math.max(0, (startAt - p.startMs) / 1000);
        }
        setPlayback(p);
      },
      () => setFailed(true),
    );
  }, [api, meetingId, startAt]);
  useEffect(load, [load]);

  useImperativeHandle(ref, () => ({
    playFrom(sessionMs) {
      const el = video.current;
      if (el === null || playback == null) return;
      const seconds = Math.max(0, (sessionMs - playback.startMs) / 1000);
      if (el.readyState === 0) pendingSeek.current = seconds;
      else el.currentTime = seconds;
      // Chrome may refuse to start with sound outside a click; the seek still happened.
      el.play().catch(() => undefined);
      box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    pause() {
      video.current?.pause();
    },
  }));

  if (failed) {
    return <p className="meta">Video couldn&rsquo;t be loaded. Refresh to try again.</p>;
  }
  if (playback === undefined) {
    return (
      <div className="video-slot">
        <SkeletonRows rows={2} />
      </div>
    );
  }
  if (playback === null) {
    return <p className="meta">Preparing video…</p>;
  }

  const toggle = () => {
    const el = video.current;
    if (el === null) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  };
  const seekBy = (seconds: number) => {
    const el = video.current;
    if (el !== null) el.currentTime = Math.min(Math.max(0, el.currentTime + seconds), duration);
  };
  const download = async () => {
    setDownloading(true);
    try {
      const file = await api.getVideo(meetingId, { download: true });
      // The signed URL answers with Content-Disposition: attachment, so this saves the file.
      if (file !== null) window.location.assign(file.url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      ref={box}
      className="player"
      tabIndex={0}
      aria-label="Meeting video"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === ' ') {
          e.preventDefault();
          toggle();
        } else if (e.key === 'ArrowLeft') seekBy(-5);
        else if (e.key === 'ArrowRight') seekBy(5);
      }}
    >
      <video
        ref={video}
        className="player-video"
        src={playback.url}
        poster={playback.posterUrl ?? undefined}
        preload="metadata"
        playsInline
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          onPlayingChange?.(true);
        }}
        onPause={() => {
          setPlaying(false);
          onPlayingChange?.(false);
        }}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          e.currentTarget.playbackRate = speed;
          if (pendingSeek.current !== null) {
            e.currentTarget.currentTime = pendingSeek.current;
            pendingSeek.current = null;
            if (startAt !== null) e.currentTarget.play().catch(() => undefined);
          }
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setTime(t);
          onSessionTime?.(playback.startMs + t * 1000);
        }}
        onEnded={() => onSessionTime?.(null)}
        onError={() => {
          // Most likely the signed URL expired while the page was open.
          if (retried.current) setFailed(true);
          else {
            retried.current = true;
            load();
          }
        }}
      />
      <div className="player-bar">
        <Button
          variant="ghost"
          size="sm"
          className="icon-btn"
          aria-label={playing ? 'Pause video' : 'Play video'}
          onClick={toggle}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </Button>
        <span className="num player-time">
          {formatClock(time * 1000)} / {formatClock(duration * 1000)}
        </span>
        <input
          type="range"
          className="player-seek"
          aria-label="Seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          onChange={(e) => {
            const el = video.current;
            if (el !== null) el.currentTime = Number(e.target.value);
          }}
        />
        {!compact && (
          <select
            className="player-speed"
            aria-label="Playback speed"
            value={speed}
            onChange={(e) => {
              const next = Number(e.target.value) as (typeof SPEEDS)[number];
              setSpeed(next);
              if (video.current !== null) video.current.playbackRate = next;
            }}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        )}
        {!compact && (
          <Button
            variant="ghost"
            size="sm"
            className="icon-btn"
            aria-label="Download video"
            disabled={downloading}
            onClick={() => void download()}
          >
            <Icon name="download" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="icon-btn"
          aria-label="Full screen"
          onClick={() => void box.current?.requestFullscreen()}
        >
          <Icon name="maximize" />
        </Button>
      </div>
    </div>
  );
}
