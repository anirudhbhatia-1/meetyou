import { describe, expect, it } from 'vitest';

import { MIC_CONSTRAINTS, tabCaptureConstraints } from './capture.ts';

describe('capture constraints', () => {
  it('passes the stream ID with the chromeMediaSource tab constraint', () => {
    expect(tabCaptureConstraints('sid-1', false)).toEqual({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'sid-1' } },
      video: false,
    });
  });

  it('asks for tab video in the same call, capped at 720p 15 fps', () => {
    expect(tabCaptureConstraints('sid-2', true).video).toEqual({
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: 'sid-2',
        maxWidth: 1280,
        maxHeight: 720,
        maxFrameRate: 15,
      },
    });
  });

  it('keeps echo cancellation on for the mic lane', () => {
    expect(MIC_CONSTRAINTS).toEqual({ audio: { echoCancellation: true }, video: false });
  });
});
