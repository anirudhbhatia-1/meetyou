import { describe, expect, it } from 'vitest';

import {
  parseBackgroundMessage,
  parseCaptureStartResult,
  parseCaptureStatusReply,
  parseCaptureStopReply,
  parseMeetCallState,
  parseMeetStateReply,
  parseOffscreenMessage,
  parseSidePanelMessage,
  senderTabId,
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

  it('requires a stream ID and a video flag for capture.start', () => {
    const base = { target: 'offscreen', type: 'capture.start' };
    expect(parseOffscreenMessage(base)).toBeNull();
    expect(parseOffscreenMessage({ ...base, streamId: '', recordVideo: true })).toBeNull();
    expect(parseOffscreenMessage({ ...base, streamId: 'abc' })).toBeNull();
    expect(parseOffscreenMessage({ ...base, streamId: 'abc', recordVideo: false })).toEqual({
      ...base,
      streamId: 'abc',
      recordVideo: false,
    });
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
