import { createHash } from 'node:crypto';

import {
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes,
  type Context,
  type Tracer,
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TracerProvider,
  TraceIdRatioBasedSampler,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';
import { errorCode, safeField } from '@meetyou/log';
import { GoogleAuth } from 'google-auth-library';

/**
 * Tracing (S2-11, ARCHITECTURE §20): session start → stream → STT → segment write, and each worker
 * job, as spans in **one trace per meeting**. The trace ID is derived from the meeting ID, so the
 * API, gateway and worker join the same trace without passing context between them, and all three
 * make the same sampling decision. Spans are recorded with explicit times (no async context).
 * Attributes follow the log allow-list (`@meetyou/log`): IDs, counts, codes, never content.
 *
 * Export: OTLP over HTTP/protobuf to Google Cloud's Telemetry API (`telemetry.googleapis.com`),
 * authenticated with the service account's Application Default Credentials. Verified against
 * Google's migration guide (opentelemetry-operations-js MIGRATION.md, 2026-11-06); the legacy
 * Cloud Trace exporter is deprecated.
 */

const TRACER = 'meetyou';
const OTLP_TRACES_URL = 'https://telemetry.googleapis.com/v1/traces';

export type SpanFields = Record<string, string | number | boolean | null | undefined>;

let sampleRatio = 1;
let provider: TracerProvider | undefined;

function tracer(): Tracer {
  return trace.getTracer(TRACER);
}

function attributes(fields: SpanFields): Attributes {
  const kept: Attributes = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && safeField(key, value)) kept[key] = value;
  }
  return kept;
}

/** The meeting's trace as a remote parent: same IDs and sampling in every service. */
export function meetingParent(meetingId: string, ratio = sampleRatio): Context {
  const hash = createHash('sha256').update(`meetyou-trace:${meetingId}`).digest('hex');
  const sampled = parseInt(hash.slice(48, 56), 16) / 0x1_0000_0000 < ratio;
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: hash.slice(0, 32),
    spanId: hash.slice(32, 48),
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  });
}

/** Records one finished span in the meeting's trace. `error` marks it failed (class/code only). */
export function recordSpan(
  name: string,
  meetingId: string,
  fields: SpanFields,
  startMs: number,
  endMs: number = Date.now(),
  error?: unknown,
): void {
  const span = tracer().startSpan(
    name,
    { startTime: startMs, attributes: attributes({ ...fields, meetingId }) },
    meetingParent(meetingId),
  );
  if (error !== undefined) {
    span.setAttribute('errorCode', errorCode(error));
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
  span.end(endMs);
}

/** Runs `work` and records it as a span in the meeting's trace, failed if it throws. */
export async function traced<T>(
  name: string,
  meetingId: string,
  fields: SpanFields,
  work: () => Promise<T>,
): Promise<T> {
  const startMs = Date.now();
  try {
    const result = await work();
    recordSpan(name, meetingId, fields, startMs);
    return result;
  } catch (error) {
    recordSpan(name, meetingId, fields, startMs, Date.now(), error);
    throw error;
  }
}

export interface TracingHandle {
  enabled: boolean;
  /** Flushes buffered spans; call on SIGTERM (Cloud Run allows 10 s). */
  shutdown(): Promise<void>;
}

/**
 * Turns tracing on inside Cloud Run (a service sets `K_SERVICE`, a job `CLOUD_RUN_JOB`) unless
 * `TRACING=off`. `TRACE_SAMPLE_RATIO` (0–1, default 1) is the share of meetings traced. Elsewhere
 * (local, tests) the OpenTelemetry API stays a no-op. `processor` replaces the exporter in tests.
 */
export function startTracing(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
  processor?: SpanProcessor,
): TracingHandle {
  const onCloudRun = env.K_SERVICE !== undefined || env.CLOUD_RUN_JOB !== undefined;
  if (processor === undefined && (!onCloudRun || env.TRACING === 'off')) {
    return { enabled: false, shutdown: async () => undefined };
  }
  const ratio = Number(env.TRACE_SAMPLE_RATIO ?? '1');
  sampleRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1;
  provider = new TracerProvider({
    resource: resourceFromAttributes({
      'service.name': service,
      // The Telemetry API needs the project as a resource attribute; ADC knows it on Cloud Run.
      ...(processor === undefined ? { 'gcp.project_id': auth.getProjectId() } : {}),
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRatio) }),
    spanProcessors: [processor ?? new BatchSpanProcessor({ exporter: cloudExporter() })],
  });
  trace.setGlobalTracerProvider(provider);
  const active = provider;
  return {
    enabled: true,
    shutdown: async () => {
      await active.shutdown();
      trace.disable();
      provider = undefined;
    },
  };
}

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

/** OTLP exporter with a fresh OAuth token per export (tokens expire after an hour). */
function cloudExporter(): OTLPTraceExporter {
  return new OTLPTraceExporter({
    url: OTLP_TRACES_URL,
    headers: async () => {
      const client = await auth.getClient();
      return Object.fromEntries((await client.getRequestHeaders()).entries());
    },
  });
}
