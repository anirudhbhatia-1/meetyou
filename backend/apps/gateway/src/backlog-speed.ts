import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { OggOpusWriter, readOggOpusPackets } from '@meetyou/storage';
import { deepgramProvider } from '@meetyou/providers';
import type { SttInput, SttResult } from '@meetyou/providers';

/**
 * ARCHITECTURE §26.2 Q5: can a reconnect backlog be sent to the STT provider faster than real
 * time? Streams the first N seconds of a 16 kHz mono WAV (public/synthetic audio only) at a speed
 * factor through the gateway's own provider adapter, as PCM16 or as the gateway's Ogg Opus.
 *   node --env-file=.env.bench backend/apps/gateway/src/backlog-speed.ts <wav> [seconds] [speed]
 * Opus needs ffmpeg (libopus) to encode; the packets are re-wrapped by our Ogg writer.
 */
const [wavPath, secondsArg = '60', speedArg = '10', inputArg = 'pcm16'] = process.argv.slice(2);
if (wavPath === undefined) {
  console.error('usage: backlog-speed.ts <wav> [seconds] [speed] [pcm16|ogg_opus]');
  process.exit(2);
}
const key = process.env.DEEPGRAM_API_KEY;
if (!key) {
  console.error('DEEPGRAM_API_KEY missing (use --env-file=.env.bench)');
  process.exit(2);
}
const seconds = Number(secondsArg);
const speed = Number(speedArg);
const input = inputArg as SttInput;

/** 100 ms units of the input: PCM16 slices, or Ogg pages of five 20 ms packets. */
function units(): Uint8Array[] {
  if (input === 'pcm16') {
    const wav = readFileSync(wavPath as string);
    const dataAt = wav.indexOf('data') + 8;
    const pcm = wav.subarray(dataAt, dataAt + seconds * 32_000);
    const out: Uint8Array[] = [];
    for (let o = 0; o < pcm.byteLength; o += 3200) out.push(pcm.subarray(o, o + 3200));
    return out;
  }
  const ogg = execFileSync('ffmpeg', [
    ...['-loglevel', 'error', '-t', String(seconds), '-i', wavPath as string],
    ...['-ar', '16000', '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip'],
    ...['-frame_duration', '20', '-f', 'ogg', 'pipe:1'],
  ]);
  const packets = readOggOpusPackets(new Uint8Array(ogg));
  const writer = new OggOpusWriter({ serial: 7 });
  const out = [writer.headers()];
  for (let i = 0; i < packets.length; i += 5) out.push(writer.packets(packets.slice(i, i + 5)));
  return out;
}

const audio = units();
const finals: SttResult[] = [];
let firstResultAt: number | null = null;
const stream = await deepgramProvider(key).open(input, {
  onResult(result) {
    firstResultAt ??= performance.now();
    if (result.final) finals.push(result);
  },
  onClosed: (reason) => console.log('provider closed early:', reason),
});

const started = performance.now();
const intervalMs = 100 / speed;
for (let i = 0; i < audio.length; i++) {
  stream.send(audio[i] as Uint8Array);
  const due = started + (i + 1) * intervalMs;
  const wait = due - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
const sentAt = performance.now();
await stream.close();
const doneAt = performance.now();

const lastEnd = finals.reduce((n, f) => Math.max(n, f.endMs), 0);
const words = finals.reduce((n, f) => n + (f.words?.length ?? 0), 0);
console.log(
  JSON.stringify({
    input,
    audioSeconds: seconds,
    speedRequested: speed,
    sendSeconds: +((sentAt - started) / 1000).toFixed(2),
    totalSeconds: +((doneAt - started) / 1000).toFixed(2),
    effectiveSpeed: +(seconds / ((doneAt - started) / 1000)).toFixed(2),
    firstResultSeconds:
      firstResultAt === null ? null : +((firstResultAt - started) / 1000).toFixed(2),
    finals: finals.length,
    words,
    transcribedUpToSeconds: +(lastEnd / 1000).toFixed(1),
  }),
);
