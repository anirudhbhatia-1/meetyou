import { describe, expect, it } from 'vitest';

import { pickVideoMimeType, VIDEO_MIME_TYPES } from './video-recorder.ts';

describe('pickVideoMimeType', () => {
  it('prefers MP4/H.264 and falls back to WebM/VP9 (ADR-0011 §3.2)', () => {
    expect(pickVideoMimeType(() => true)).toBe(VIDEO_MIME_TYPES[0]);
    expect(pickVideoMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(pickVideoMimeType(() => false)).toBeNull();
  });
});
