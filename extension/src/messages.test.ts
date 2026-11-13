import { describe, expect, it } from 'vitest';

import {
  parseBackgroundMessage,
  parseCaptureStartResult,
  parseCaptureStatusReply,
  parseCaptureStopReply,
  parseMeetCallState,
  parseMeetMuteReply,
  parseMeetStateReply,
  parseOffscreenMessage,
  parseSidePanelMessage,
  senderTabId,
  parseConsentResult,
} from './messages.ts';

describe('message parsers', () => {
  it('accept messages only for their own target', () => {
    const start = { target: 'background', type: 'recording.start' };
    expect(parseBackgroundMessage(start)).toEqual(start);
    expect(parseOffscreenMessage(start)).toBeNull();
    expect(parseSidePanelMessage(start)).toBeNull();
    expect(parseBackgroundMessage({ target: 'background', type: 'recording.delete' })).toBeNull();
    expect(parseBackgroundMessage('offscreen.ensure')).toBeNull();

    // The prompt chip cannot start recording (Chrome refuses page clicks for tab capture).
    const promptStart = { target: 'background', type: 'prompt.start-recording' };
    expect(parseBackgroundMessage(promptStart)).toBeNull();
  });

  it('validates link and video values', () => {
    expect(
      parseBackgroundMessage({ target: 'background', type: 'capture.link', link: 'online' }),
    ).toEqual({ target: 'background', type: 'capture.link', link: 'online' });
    expect(
      parseBackgroundMessage({ target: 'background', type: 'capture.link', link: 'warp' }),
    ).toBeNull();
    expect(
      parseBackgroundMessage({ target: 'background', type: 'capture.video', video: 'failed' }),
    ).toEqual({ target: 'background', type: 'capture.video', video: 'failed' });
  });

  it('requires a stream ID, a video flag and a video quality for capture.start', () => {
    const base = { target: 'offscreen', type: 'capture.start' };
    const q = { videoQuality: 'standard' };
    expect(parseOffscreenMessage(base)).toBeNull();
    expect(parseOffscreenMessage({ ...base, ...q, streamId: '', recordVideo: true })).toBeNull();
    expect(parseOffscreenMessage({ ...base, ...q, streamId: 'abc' })).toBeNull();
    expect(parseOffscreenMessage({ ...base, streamId: 'abc', recordVideo: false })).toBeNull();
    expect(
      parseOffscreenMessage({ ...base, streamId: 'abc', recordVideo: false, videoQuality: 'hd' }),
    ).toBeNull();
    expect(
      parseOffscreenMessage({
        ...base,
        streamId: 'abc',
        recordVideo: false,
        videoQuality: 'data_saver',
      }),
    ).toEqual({ ...base, streamId: 'abc', recordVideo: false, videoQuality: 'data_saver' });
    expect(parseOffscreenMessage({ target: 'offscreen', type: 'capture.pause' })).toEqual({
      target: 'offscreen',
      type: 'capture.pause',
    });
  });

  it('accepts finite levels and a null me lane', () => {
    const levels = { target: 'sidepanel', type: 'capture.levels', me: null, them: -20 };
    expect(parseSidePanelMessage(levels)).toEqual(levels);
    expect(parseSidePanelMessage({ ...levels, them: Number.NaN })).toBeNull();
    expect(parseSidePanelMessage({ ...levels, me: 'loud' })).toBeNull();
  });

  it('accepts transcript lines only for known lanes', () => {
    const line = {
      target: 'sidepanel',
      type: 'transcript',
      final: true,
      lane: 'them',
      text: 'haan theek hai',
      startMs: 1200,
      speaker: 'spk_2',
    };
    expect(parseSidePanelMessage(line)).toEqual(line);
    expect(parseSidePanelMessage({ ...line, lane: 'both' })).toBeNull();
    expect(parseSidePanelMessage({ ...line, speaker: null })).toEqual({ ...line, speaker: null });
    expect(parseSidePanelMessage({ ...line, speaker: 3 })).toBeNull();
  });

  it('parses capture start and status replies', () => {
    const ok = {
      ok: true,
      sessionId: 's1',
      lanes: { me: false, them: true },
      micError: 'NotAllowedError',
      link: 'connecting',
      video: 'recording',
    };
    expect(parseCaptureStartResult(ok)).toEqual(ok);
    expect(parseCaptureStartResult({ ...ok, video: 'maybe' })).toBeNull();
    expect(parseCaptureStartResult({ ok: false, reason: 'tab_capture_failed' })).toEqual({
      ok: false,
      reason: 'tab_capture_failed',
    });
    expect(parseCaptureStartResult({ ok: false, reason: 'other' })).toBeNull();
    expect(parseCaptureStartResult(undefined)).toBeNull();
    expect(parseCaptureStatusReply({ active: true })).toEqual({ active: true, busy: false });
    expect(parseCaptureStatusReply({ active: false, busy: true })).toEqual({
      active: false,
      busy: true,
    });
    expect(parseCaptureStatusReply({})).toBeNull();
    expect(parseCaptureStopReply({ ok: true, uploading: true })).toEqual({
      ok: true,
      uploading: true,
    });
    expect(parseCaptureStopReply({ ok: true })).toEqual({ ok: true, uploading: false });
    expect(parseCaptureStopReply({ uploading: true })).toBeNull();
  });

  it('parses the video upload messages (ADR-0011 §3.3)', () => {
    expect(parseBackgroundMessage({ target: 'background', type: 'capture.upload_idle' })).toEqual({
      target: 'background',
      type: 'capture.upload_idle',
    });
    const upload = { target: 'sidepanel', type: 'video.upload', pending: 3, uploaded: 7 };
    expect(parseSidePanelMessage(upload)).toEqual(upload);
    expect(parseSidePanelMessage({ ...upload, pending: -1 })).toBeNull();
    expect(parseSidePanelMessage({ ...upload, uploaded: 1.5 })).toBeNull();
  });

  it('reads the call state from the Meet adapter and the sender tab', () => {
    const msg = { type: 'meet.state-changed', snapshot: { state: 'ended' }, metadata: {} };
    expect(parseMeetCallState(msg)).toBe('ended');
    expect(parseMeetCallState({ ...msg, snapshot: { state: 'gone' } })).toBeNull();
    expect(parseMeetCallState({ type: 'meet.page-ready' })).toBeNull();
    expect(parseMeetStateReply({ snapshot: { state: 'in_call' }, metadata: {} })).toBe('in_call');
    expect(parseMeetStateReply(undefined)).toBeNull();
    expect(senderTabId({ tab: { id: 12 } })).toBe(12);
    expect(senderTabId({ id: 'extension' })).toBeNull();
  });
});

describe('Meet mute (FR-CAP-11, D-10)', () => {
  it('parses the offscreen mute message and nothing malformed', () => {
    expect(
      parseOffscreenMessage({ target: 'offscreen', type: 'capture.mic_muted', muted: true }),
    ).toEqual({
      target: 'offscreen',
      type: 'capture.mic_muted',
      muted: true,
    });
    expect(parseOffscreenMessage({ target: 'offscreen', type: 'capture.mic_muted' })).toBeNull();
    expect(
      parseOffscreenMessage({ target: 'offscreen', type: 'capture.mic_muted', muted: 'yes' }),
    ).toBeNull();
  });

  it("reads the mute state from the tab's meet.get-state reply", () => {
    expect(parseMeetMuteReply({ muteState: { isMuted: true, matchedBy: 'x' } })).toBe(true);
    expect(parseMeetMuteReply({ muteState: { isMuted: false } })).toBe(false);
    expect(parseMeetMuteReply({ muteState: { isMuted: null } })).toBeNull();
    expect(parseMeetMuteReply(undefined)).toBeNull();
  });
});

describe('Meet speaker signal (S3-04)', () => {
  it('parses a bounded speaker message and nothing malformed', () => {
    expect(
      parseOffscreenMessage({
        target: 'offscreen',
        type: 'capture.speaker',
        participantId: ' spaces/abc/devices/7 ',
        displayName: `  ${'N'.repeat(250)}`,
        at: 1_762_000_000_000,
      }),
    ).toEqual({
      target: 'offscreen',
      type: 'capture.speaker',
      participantId: 'spaces/abc/devices/7',
      displayName: 'N'.repeat(200),
      at: 1_762_000_000_000,
    });
    for (const bad of [
      { participantId: '', displayName: 'Neha' },
      { participantId: 'x'.repeat(201), displayName: 'Neha' },
      { participantId: 'p1', displayName: '   ' },
      { participantId: 7, displayName: 'Neha', at: 1 },
      { participantId: 'p1', displayName: 'Neha' },
    ]) {
      expect(
        parseOffscreenMessage({ target: 'offscreen', type: 'capture.speaker', ...bad }),
      ).toBeNull();
    }
  });
});

describe('recording.start tab (2026-11-13)', () => {
  it('keeps the panel tab id and drops anything that is not a tab id', () => {
    expect(
      parseBackgroundMessage({ target: 'background', type: 'recording.start', tabId: 42 }),
    ).toEqual({ target: 'background', type: 'recording.start', tabId: 42 });
    for (const tabId of [-1, 1.5, '42', null, Number.NaN]) {
      expect(
        parseBackgroundMessage({ target: 'background', type: 'recording.start', tabId }),
      ).toEqual({ target: 'background', type: 'recording.start' });
    }
    expect(
      parseBackgroundMessage({
        target: 'background',
        type: 'recording.start',
        consent: { post: false, text: 'x' },
        tabId: 7,
      }),
    ).toEqual({
      target: 'background',
      type: 'recording.start',
      consent: { post: false, text: 'x' },
      tabId: 7,
    });
  });
});

describe('consent messages (S4-07)', () => {
  it('carries the consent step answer on recording.start, bounded', () => {
    expect(parseBackgroundMessage({ target: 'background', type: 'recording.start' })).toEqual({
      target: 'background',
      type: 'recording.start',
    });
    expect(
      parseBackgroundMessage({
        target: 'background',
        type: 'recording.start',
        consent: { post: true, text: 'Hi all' },
      }),
    ).toEqual({
      target: 'background',
      type: 'recording.start',
      consent: { post: true, text: 'Hi all' },
    });
    // A malformed or oversized answer is dropped, not trusted.
    expect(
      parseBackgroundMessage({
        target: 'background',
        type: 'recording.start',
        consent: { post: 'yes', text: 'x'.repeat(2000) },
      }),
    ).toEqual({ target: 'background', type: 'recording.start' });
  });

  it('reads back the stored consent result only when well formed', () => {
    expect(parseConsentResult({ sessionId: 's1', outcome: 'failed', text: 'Hi' })).toEqual({
      sessionId: 's1',
      outcome: 'failed',
      text: 'Hi',
    });
    expect(parseConsentResult({ sessionId: 's1', outcome: 'maybe', text: 'Hi' })).toBeNull();
  });
});

describe('side panel failure states (S4-08)', () => {
  it('parses a microphone choice, default or a bounded device ID', () => {
    expect(
      parseBackgroundMessage({ target: 'background', type: 'recording.mic', deviceId: null }),
    ).toEqual({ target: 'background', type: 'recording.mic', deviceId: null });
    expect(
      parseOffscreenMessage({ target: 'offscreen', type: 'capture.mic', deviceId: 'abc' }),
    ).toEqual({ target: 'offscreen', type: 'capture.mic', deviceId: 'abc' });
    for (const deviceId of ['', 'x'.repeat(257), 3, undefined]) {
      expect(
        parseBackgroundMessage({ target: 'background', type: 'recording.mic', deviceId }),
      ).toBeNull();
    }
  });

  it('parses a video quality report from the recorder', () => {
    const msg = { target: 'background', type: 'capture.video_quality', quality: 'data_saver' };
    expect(parseBackgroundMessage({ ...msg, auto: true })).toEqual({ ...msg, auto: true });
    expect(parseBackgroundMessage(msg)).toBeNull();
    expect(parseBackgroundMessage({ ...msg, quality: 'hd', auto: true })).toBeNull();
  });

  it('parses the switch, the session limit and its warning', () => {
    for (const type of ['recording.switch', 'capture.limit_reached']) {
      expect(parseBackgroundMessage({ target: 'background', type })).toEqual({
        target: 'background',
        type,
      });
    }
    expect(parseSidePanelMessage({ target: 'sidepanel', type: 'capture.limit_warning' })).toEqual({
      target: 'sidepanel',
      type: 'capture.limit_warning',
    });
  });
});
