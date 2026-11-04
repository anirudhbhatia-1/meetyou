import type { CaptureFailure, Lane, LaneFlags } from '../messages.ts';
import { SILENCE_DBFS } from './levels.ts';
import { captureMsFor, SAMPLE_RATE } from './pcm-framer.ts';

const LEVEL_INTERVAL_MS = 250;

/** ADR-0011 §3.2: tab video capped at 720p, 15 fps. */
export const TAB_VIDEO_LIMITS = { maxWidth: 1280, maxHeight: 720, maxFrameRate: 15 };

/** Error carrying the reason the service worker records in the capture state. */
export class CaptureStartError extends Error {
  readonly reason: CaptureFailure;

  constructor(reason: CaptureFailure, cause: unknown) {
    super(reason, { cause });
    this.reason = reason;
  }
}

/**
 * Chrome's non-standard constraint for a tabCapture stream ID
 * (developer.chrome.com/docs/extensions/reference/api/tabCapture#method-getMediaStreamId). A stream
 * ID can be used only once, so audio and video are requested in the same call.
 */
export function tabCaptureConstraints(streamId: string, video: boolean): MediaStreamConstraints {
  const source = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
  const audio = { mandatory: source };
  return {
    audio: audio as unknown as MediaTrackConstraints,
    video: video
      ? ({ mandatory: { ...source, ...TAB_VIDEO_LIMITS } } as unknown as MediaTrackConstraints)
      : false,
  };
}

/**
 * Echo cancellation is required so remote voices played on speakers do not leak into `me`
 * (FR-CAP-03). Noise suppression and auto gain stay at Chrome's defaults (on); whether they help
 * STT is measured in S1-11.
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true },
  video: false,
};

export interface CaptureCallbacks {
  /** One 100 ms PCM16 frame of one lane, placed on the shared session clock. */
  onFrame(lane: Lane, pcm: Int16Array<ArrayBuffer>, captureMs: number): void;
  onTabEnded(): void;
  onMicLost(): void;
  onLevels(me: number | null, them: number): void;
}

export interface CaptureSession {
  readonly lanes: LaneFlags;
  readonly micError: string | null;
  /** Tab video track when requested, else null. */
  readonly video: MediaStreamTrack | null;
  /** Playback mix of both lanes for the video file only; STT always uses the separate lanes. */
  readonly mixedAudio: MediaStreamTrack;
  /** Current session-clock time in ms (ARCHITECTURE §5.5). */
  nowMs(): number;
  stop(): Promise<void>;
}

function errorName(error: unknown): string {
  return error instanceof DOMException || error instanceof Error ? error.name : 'UnknownError';
}

interface FramerMessage {
  pcm: ArrayBuffer;
  startFrame: number;
  levelDbfs: number;
}

function isFramerMessage(value: unknown): value is FramerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.pcm instanceof ArrayBuffer &&
    typeof v.startFrame === 'number' &&
    typeof v.levelDbfs === 'number'
  );
}

/**
 * Opens both lanes and keeps them separate (FR-CAP-04).
 * - Playback context (device rate): the tab stream is played back because capturing a tab mutes it
 *   (FR-CAP-02); it also builds the playback mix for video. The mic is never played back.
 * - Capture context at 16 kHz: Chrome resamples each source; the `pcm-framer` worklet downmixes,
 *   converts to PCM16 and emits 100 ms frames (FR-CAP-05). Both lanes share this context's clock.
 * A missing or denied mic is not fatal: the tab-only recording continues (FR-ONB-03).
 */
export async function startCapture(options: {
  streamId: string;
  video: boolean;
  workletUrl: string;
  callbacks: CaptureCallbacks;
}): Promise<CaptureSession> {
  const { callbacks } = options;
  let tab: MediaStream;
  try {
    tab = await navigator.mediaDevices.getUserMedia(
      tabCaptureConstraints(options.streamId, options.video),
    );
  } catch (error: unknown) {
    throw new CaptureStartError('tab_capture_failed', error);
  }

  let mic: MediaStream | null = null;
  let micError: string | null = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  } catch (error: unknown) {
    micError = errorName(error);
  }

  const stopTracks = (): void => {
    for (const track of [...tab.getTracks(), ...(mic?.getTracks() ?? [])]) track.stop();
  };

  let playback: AudioContext | null = null;
  let capture: AudioContext | null = null;
  try {
    playback = new AudioContext();
    const tabPlayback = playback.createMediaStreamSource(tab);
    tabPlayback.connect(playback.destination);
    const mix = playback.createMediaStreamDestination();
    tabPlayback.connect(mix);
    if (mic !== null) playback.createMediaStreamSource(mic).connect(mix);
    if (playback.state === 'suspended') await playback.resume();

    capture = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (capture.sampleRate !== SAMPLE_RATE) {
      throw new Error(`capture context runs at ${capture.sampleRate} Hz`);
    }
    await capture.audioWorklet.addModule(options.workletUrl);
    if (capture.state === 'suspended') await capture.resume();

    const ctx = capture;
    const sessionStartFrame = Math.round(ctx.currentTime * SAMPLE_RATE);
    // Worklet output is silent; routing it to the destination keeps Chrome pulling the node.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);

    const levels: Record<Lane, number | null> = { me: null, them: SILENCE_DBFS };
    const nodes: Partial<Record<Lane, AudioWorkletNode>> = {};
    const addLane = (lane: Lane, stream: MediaStream): void => {
      const node = new AudioWorkletNode(ctx, 'pcm-framer', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!isFramerMessage(event.data)) return;
        levels[lane] = event.data.levelDbfs;
        callbacks.onFrame(
          lane,
          new Int16Array(event.data.pcm),
          captureMsFor(event.data.startFrame, sessionStartFrame),
        );
      };
      ctx.createMediaStreamSource(stream).connect(node);
      node.connect(sink);
      nodes[lane] = node;
    };
    addLane('them', tab);
    if (mic !== null) addLane('me', mic);

    tab.getAudioTracks()[0]?.addEventListener('ended', () => callbacks.onTabEnded(), {
      once: true,
    });
    mic?.getAudioTracks()[0]?.addEventListener(
      'ended',
      () => {
        nodes.me?.disconnect();
        nodes.me = undefined;
        levels.me = null;
        callbacks.onMicLost();
      },
      { once: true },
    );

    const levelTimer = setInterval(() => {
      callbacks.onLevels(levels.me, levels.them ?? SILENCE_DBFS);
    }, LEVEL_INTERVAL_MS);

    const playbackCtx = playback;
    const mixedAudio = mix.stream.getAudioTracks()[0];
    if (mixedAudio === undefined) throw new Error('playback mix has no audio track');

    return {
      lanes: { me: mic !== null, them: true },
      micError,
      video: tab.getVideoTracks()[0] ?? null,
      mixedAudio,
      nowMs: () => captureMsFor(Math.round(ctx.currentTime * SAMPLE_RATE), sessionStartFrame),
      async stop() {
        clearInterval(levelTimer);
        for (const node of Object.values(nodes)) node.port.onmessage = null;
        stopTracks();
        await Promise.all([ctx.close(), playbackCtx.close()]);
      },
    };
  } catch (error: unknown) {
    stopTracks();
    await Promise.allSettled([playback?.close(), capture?.close()]);
    throw new CaptureStartError('audio_context_failed', error);
  }
}
