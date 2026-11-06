import { SpanStatusCode, trace, TraceFlags } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { meetingParent, recordSpan, startTracing, traced, type TracingHandle } from './index.ts';

describe('meeting trace IDs', () => {
  it('derives the same trace for a meeting in every service, and different ones per meeting', () => {
    const a = trace.getSpanContext(meetingParent('mtg_A'));
    const again = trace.getSpanContext(meetingParent('mtg_A'));
    const b = trace.getSpanContext(meetingParent('mtg_B'));
    expect(a?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(again?.traceId).toBe(a?.traceId);
    expect(b?.traceId).not.toBe(a?.traceId);
  });

  it('samples by meeting: ratio 0 never, ratio 1 always', () => {
    expect(trace.getSpanContext(meetingParent('mtg_A', 0))?.traceFlags).toBe(TraceFlags.NONE);
    expect(trace.getSpanContext(meetingParent('mtg_A', 1))?.traceFlags).toBe(TraceFlags.SAMPLED);
  });
});

describe('spans', () => {
  let exporter: InMemorySpanExporter;
  let handle: TracingHandle;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    handle = startTracing('test', {}, new SimpleSpanProcessor({ exporter }));
  });

  afterEach(async () => {
    await handle.shutdown();
  });

  it('records spans of one meeting in one trace, with only allow-listed fields', () => {
    recordSpan('stream.admit', 'mtg_A', { sessionId: 'ses_1', speaker: 'Asha Rao' }, 1_000, 1_250);
    recordSpan('segment.store', 'mtg_A', { count: 3 }, 2_000, 2_010);
    const spans = exporter.getFinishedSpans();
    expect(spans.map((s) => s.name)).toEqual(['stream.admit', 'segment.store']);
    expect(spans[0]?.spanContext().traceId).toBe(spans[1]?.spanContext().traceId);
    expect(spans[0]?.parentSpanContext?.spanId).toBe(
      trace.getSpanContext(meetingParent('mtg_A'))?.spanId,
    );
    // A name is content: dropped. IDs and counts stay.
    expect(spans[0]?.attributes).toEqual({ sessionId: 'ses_1', meetingId: 'mtg_A' });
    expect(spans[1]?.attributes).toMatchObject({ count: 3 });
  });

  it('marks a failed span with the error class only', async () => {
    class StorageUnavailable extends Error {
      override name = 'StorageUnavailable';
    }
    await expect(
      traced('chunk.write', 'mtg_A', {}, () =>
        Promise.reject(new StorageUnavailable('bucket meetyou-private-path')),
      ),
    ).rejects.toThrow();
    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.status.message).toBeUndefined();
    expect(span?.attributes.errorCode).toBe('StorageUnavailable');
    expect(JSON.stringify(span?.attributes)).not.toContain('private');
  });

  it('returns the result of traced work', async () => {
    expect(await traced('job.run', 'mtg_A', { task: 'video.finalize' }, async () => 7)).toBe(7);
    expect(exporter.getFinishedSpans()[0]?.attributes).toMatchObject({ task: 'video.finalize' });
  });
});

describe('startTracing', () => {
  it('stays off outside Cloud Run and when TRACING=off', async () => {
    expect(startTracing('api', {}).enabled).toBe(false);
    expect(startTracing('api', { K_SERVICE: 'meetyou-staging-api', TRACING: 'off' }).enabled).toBe(
      false,
    );
  });
});
