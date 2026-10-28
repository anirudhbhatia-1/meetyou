import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderOptions, StreamLogLine } from './schemas.ts';
import {
  sleep,
  type Emit,
  type RunContext,
  type StreamProvider,
  type StreamSession,
} from './providers/types.ts';
import type { PcmAudio } from './wav.ts';

const CHUNK_MS = 100;
const CHUNK_BYTES = 3200;
/** Rotate this long before a provider's hard session limit. */
const ROTATE_MARGIN_MS = 20_000;
/** Audio replayed into a new session after rotation so no words are cut at the boundary. */
const ROTATE_REPLAY_MS = 2_000;

/**
 * Plays audio into a provider in real time (100 ms chunks), logging every sent chunk and every
 * provider message with wall-clock offsets (STT_BENCHMARK_PLAN §7.1). Identical for all providers.
 */
export async function runStream(
  provider: StreamProvider,
  options: ProviderOptions,
  audio: PcmAudio,
  ctx: RunContext,
  logPath: string,
  speed = 1,
): Promise<void> {
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, '');
  const t0 = performance.now();
  const write = (line: StreamLogLine) => appendFileSync(logPath, `${JSON.stringify(line)}\n`);
  const emit: Emit = (line) =>
    write({ ...line, t: Math.round(performance.now() - t0) } as StreamLogLine);

  let session: StreamSession = await provider.open(options, ctx, emit);
  let sessionStartChunk = 0;
  const totalChunks = Math.ceil(audio.data.length / CHUNK_BYTES);
  const limit = provider.maxSessionMs;

  for (let i = 0; i < totalChunks; i++) {
    await sleep(t0 + (i * CHUNK_MS) / speed - performance.now());
    if (limit && (i - sessionStartChunk) * CHUNK_MS >= limit - ROTATE_MARGIN_MS) {
      const next = await provider.open(options, ctx, emit);
      const replayFrom = Math.max(0, i - ROTATE_REPLAY_MS / CHUNK_MS);
      for (let k = replayFrom; k < i; k++)
        next.send(audio.data.subarray(k * CHUNK_BYTES, (k + 1) * CHUNK_BYTES));
      emit({ kind: 'session', event: 'rotate', detail: `at ${i * CHUNK_MS} ms` });
      void session.end();
      session = next;
      sessionStartChunk = i;
    }
    session.send(audio.data.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
    emit({ kind: 'sent', audioMs: (i + 1) * CHUNK_MS });
  }
  await session.end();
}
