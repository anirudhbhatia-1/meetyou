import { describe, expect, it } from 'vitest';

import { createLogger, errorCode, formatLine, severityOf } from './index.ts';

const AT = new Date('2026-11-06T10:00:00Z');

describe('content-free structured logs (S2-11, AGENTS §7)', () => {
  it('writes the Cloud Logging shape with IDs, counts and codes', () => {
    expect(
      JSON.parse(
        formatLine(
          'gateway',
          'stream.ended',
          { sessionId: 'ses_1', meetingId: 'mtg_1', durationMs: 900, sttMsMe: 40, reason: 'end' },
          undefined,
          AT,
        ),
      ),
    ).toEqual({
      severity: 'INFO',
      message: 'stream.ended',
      time: '2026-11-06T10:00:00.000Z',
      service: 'gateway',
      sessionId: 'ses_1',
      meetingId: 'mtg_1',
      durationMs: 900,
      sttMsMe: 40,
      reason: 'end',
    });
  });

  it('drops fields outside the allow-list and values that look like content', () => {
    const line = JSON.parse(
      formatLine('api', 'x', {
        text: 'haan theek hai',
        email: 'a@example.com',
        token: 'eyJhbGciOi',
        displayName: 'Asha',
        reason: 'two words',
        code: 'x'.repeat(121),
        count: Number.NaN,
        meetingId: 'mtg_1',
      }),
    ) as Record<string, unknown>;
    expect(line).toMatchObject({ meetingId: 'mtg_1', dropped: 7 });
    for (const key of ['text', 'email', 'token', 'displayName', 'reason', 'code', 'count']) {
      expect(line[key]).toBeUndefined();
    }
  });

  it('derives severity from the event name, and logs explicit errors', () => {
    expect(severityOf('chunk.write_failed')).toBe('ERROR');
    expect(severityOf('http.error')).toBe('ERROR');
    expect(severityOf('stream.origin_rejected')).toBe('WARNING');
    expect(severityOf('job.dead_lettered')).toBe('WARNING');
    expect(severityOf('stream.connected')).toBe('INFO');
    const lines: string[] = [];
    createLogger('worker', (l) => lines.push(l)).error('job.dead_lettered', { task: 'x' });
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ severity: 'ERROR', task: 'x' });
  });

  it('turns errors into short codes', () => {
    const e = Object.assign(new Error('secret detail'), { code: 'ECONNRESET' });
    expect(errorCode(e)).toBe('Error:ECONNRESET');
    expect(errorCode('boom')).toBe('UnknownError');
  });
});
