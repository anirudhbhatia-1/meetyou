import { describe, expect, it } from 'vitest';

import { parseLastRecording } from '../last-recording.ts';
import {
  approxLength,
  formatBytes,
  gatewayVideoFiles,
  videoFilesFromState,
} from './recording-video.ts';

const GW = 'http://127.0.0.1:8787';
const SES = 'ses_01J0000000000000000000000A';

function part(partId: string, fragments: number, playable: number, url?: string) {
  return {
    partId,
    fragments,
    playableFragments: playable,
    url: url ?? `${GW}/v1/dev/sessions/${SES}/video/${partId}`,
  };
}

describe('recording video after the call', () => {
  it('offers one play and download link per playable part', () => {
    const files = gatewayVideoFiles([part('vp_a', 72, 72)], GW);
    expect(files).toEqual([
      {
        key: 'vp_a',
        label: 'Meeting video · 12 min',
        playUrl: `${GW}/v1/dev/sessions/${SES}/video/vp_a`,
        downloadUrl: `${GW}/v1/dev/sessions/${SES}/video/vp_a?download=1`,
        waitingFragments: 0,
      },
    ]);
  });

  it('numbers parts, skips empty ones and says when more is uploading', () => {
    const files = gatewayVideoFiles(
      [part('vp_a', 6, 6), part('vp_b', 0, 0), part('vp_c', 5, 3)],
      GW,
    );
    expect(files.map((f) => [f.label, f.waitingFragments])).toEqual([
      ['Video part 1 · 1 min', 0],
      ['Video part 2 · 30 s', 2],
    ]);
  });

  it('never links outside the gateway it was built for', () => {
    expect(gatewayVideoFiles([part('vp_a', 1, 1, 'https://evil.example/x')], GW)).toEqual([]);
    expect(gatewayVideoFiles([part('vp_a', 1, 1)], 'not a url')).toEqual([]);
  });

  it('shows the finalized file alone once video.finalize ran (S2-14)', () => {
    const playback = {
      url: `${GW}/v1/dev/sessions/${SES}/video/playback`,
      posterUrl: `${GW}/v1/dev/sessions/${SES}/video/poster`,
      bytes: 13_000_000,
    };
    expect(videoFilesFromState({ parts: [part('vp_a', 6, 6)], playback }, GW)).toEqual([
      {
        key: 'playback',
        label: 'Meeting video · 12.4 MB',
        playUrl: playback.url,
        downloadUrl: `${playback.url}?download=1`,
        waitingFragments: 0,
      },
    ]);
    expect(videoFilesFromState({ parts: [part('vp_a', 6, 6)], playback: null }, GW)).toHaveLength(
      1,
    );
    expect(
      videoFilesFromState(
        { parts: [], playback: { ...playback, url: 'https://evil.example/x' } },
        GW,
      ),
    ).toEqual([]);
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('rounds lengths from 10 s fragments', () => {
    expect(approxLength(1)).toBe('10 s');
    expect(approxLength(5)).toBe('50 s');
    expect(approxLength(9)).toBe('2 min');
  });

  it('reads the remembered last recording defensively', () => {
    expect(parseLastRecording({ sessionId: SES, startedAt: 5 })).toEqual({
      sessionId: SES,
      startedAt: 5,
    });
    expect(parseLastRecording({ sessionId: '', startedAt: 5 })).toBeNull();
    expect(parseLastRecording('x')).toBeNull();
  });
});
