import { describe, expect, it } from 'vitest';

import {
  DATA_SAVER_BACKLOG_FRAGMENTS,
  nextVideoQuality,
  pickVideoMimeType,
  VIDEO_MIME_TYPES,
} from './video-recorder.ts';

describe('pickVideoMimeType', () => {
  it('prefers MP4/H.264 and falls back to WebM/VP9 (ADR-0011 §3.2)', () => {
    expect(pickVideoMimeType(() => true)).toBe(VIDEO_MIME_TYPES[0]);
    expect(pickVideoMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(pickVideoMimeType(() => false)).toBeNull();
  });
});

describe('nextVideoQuality (ADR-0011 §3.2 data saver)', () => {
  it('switches to data saver above 2 minutes of backlog and back once it has cleared', () => {
    expect(DATA_SAVER_BACKLOG_FRAGMENTS).toBe(12);
    expect(nextVideoQuality('standard', 12)).toBe('standard');
    expect(nextVideoQuality('standard', 13)).toBe('data_saver');
    expect(nextVideoQuality('data_saver', 5)).toBe('data_saver');
    expect(nextVideoQuality('data_saver', 0)).toBe('standard');
  });
});
