import type { ProviderOptions } from '../schemas.ts';
import { deepgramBatch, deepgramStream } from './deepgram.ts';
import { geminiBatch, geminiStream } from './gemini.ts';
import { sarvamBatch, sarvamStream } from './sarvam.ts';
import type { BatchProvider, StreamProvider } from './types.ts';

export function batchProvider(o: ProviderOptions): BatchProvider {
  const map = { deepgram: deepgramBatch, sarvam: sarvamBatch, gemini: geminiBatch } as const;
  return map[o.provider] as BatchProvider;
}

export function streamProvider(o: ProviderOptions): StreamProvider {
  const map = { deepgram: deepgramStream, sarvam: sarvamStream, gemini: geminiStream } as const;
  return map[o.provider] as StreamProvider;
}
