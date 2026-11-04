import { describe, expect, it } from 'vitest';

import {
  parseBackgroundMessage,
  parseCaptureStartResult,
  parseCaptureStatusReply,
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
    };
    expect(parseSidePanelMessage(line)).toEqual(line);
    expect(parseSidePanelMessage({ ...line, lane: 'both' })).toBeNull();
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
    expect(parseCaptureStatusReply({ active: true })).toEqual({ active: true });
    expect(parseCaptureStatusReply({})).toBeNull();
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
