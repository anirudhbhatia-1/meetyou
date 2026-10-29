import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Normalizer, loadCanonicalList } from '../normalize/index.ts';
import { transliterate } from '../normalize/devanagari.ts';
import { batchProvider, streamProvider } from '../providers/index.ts';
import {
  ClipManifest,
  Reference,
  RunConfig,
  StreamLogLine,
  type Clip,
  type Hypothesis,
  type Run,
} from '../schemas.ts';
import { diarizationErrorRate, turnsFromWords } from '../score/der.ts';
import { analyseStream, detectSpeech } from '../score/latency.ts';
import {
  echoLeakage,
  hallucinationRate,
  prepareHypothesis,
  prepareReference,
  scoreText,
} from '../score/metrics.ts';
import { runStream } from '../stream-runner.ts';
import { importKaldi, summarizeScores } from './extras.ts';
import { assertSpeechFormat, readWav } from '../wav.ts';

const USAGE = `Usage: pnpm --filter @meetyou/stt-benchmark bench <command> [options]

Commands
  run-batch        Send each clip lane to each batch run; saves raw JSON      (Phase A, D, E)
  run-stream       Replay each clip lane in real time to each stream run      (Phase B, C, D, E)
  score            Score raw outputs against references; writes CSV          (§6 metrics)
  blind-samples    Make provider-blind Roman display samples for rating      (Phase G)
  measure-latency  Time TCP+TLS connects to vendor endpoints                 (ADR-0002 check 4)
  summarize        Markdown table per run from results/<--out> CSV            (ADR-0001)
  import-kaldi     Build clips + references from a Kaldi corpus (--src DIR, --prefix, --limit, --max-seconds)

Options
  --data DIR       Benchmark data directory (outside git)   default: $BENCH_DATA_DIR
  --manifest FILE  Clip manifest JSON (relative to --data)   default: manifest.json
  --config FILE    Run config JSON                           (required for run-*/score/blind-samples)
  --clips IDS      Comma-separated clip IDs to include       default: all
  --speed N        Stream replay speed (1 = real time)       default: 1
  --out FILE       score: CSV name under results/             default: scores.csv
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string' },
    manifest: { type: 'string', default: 'manifest.json' },
    config: { type: 'string' },
    clips: { type: 'string' },
    speed: { type: 'string', default: '1' },
    out: { type: 'string', default: 'scores.csv' },
    src: { type: 'string' },
    prefix: { type: 'string', default: 'kx' },
    limit: { type: 'string', default: '20' },
    'max-seconds': { type: 'string', default: '240' },
    scenario: { type: 'string', default: 'Kaldi import' },
    help: { type: 'boolean', short: 'h' },
  },
});

function dataDir(): string {
  const d = values.data ?? process.env.BENCH_DATA_DIR;
  if (!d) throw new Error('Set --data or BENCH_DATA_DIR (benchmark data never lives in git).');
  return resolve(d);
}

function loadManifest(): Clip[] {
  const m = ClipManifest.parse(
    JSON.parse(readFileSync(join(dataDir(), values.manifest ?? 'manifest.json'), 'utf8')),
  );
  const only = values.clips?.split(',').map((s) => s.trim());
  return only ? m.clips.filter((c) => only.includes(c.id)) : m.clips;
}

function loadRuns(mode?: 'batch' | 'stream'): Run[] {
  if (!values.config) throw new Error('--config is required');
  const runs = RunConfig.parse(JSON.parse(readFileSync(resolve(values.config), 'utf8'))).runs;
  return mode ? runs.filter((r) => r.mode === mode) : runs;
}

function lanesOf(clip: Clip, run: Run) {
  return run.lanes.flatMap((lane) => {
    const p = clip.lanes[lane];
    return p ? [{ lane, path: join(dataDir(), p) }] : [];
  });
}

const outPath = (...parts: string[]) => join(dataDir(), 'results', ...parts);

async function runBatch(): Promise<void> {
  for (const run of loadRuns('batch')) {
    const provider = batchProvider(run.options);
    for (const clip of loadManifest()) {
      for (const { lane, path } of lanesOf(clip, run)) {
        const target = outPath('raw', run.id, `${clip.id}.${lane}.json`);
        if (existsSync(target)) {
          console.log(`skip ${run.id} ${clip.id}.${lane} (exists)`);
          continue;
        }
        assertSpeechFormat(readWav(path), path);
        const started = new Date().toISOString();
        const t = performance.now();
        const raw = await provider.transcribe(run.options, path, {
          clipId: clip.id,
          lane,
          vocabulary: clip.vocabulary,
          ...(clip.participants ? { speakers: clip.participants } : {}),
        });
        mkdirSync(outPath('raw', run.id), { recursive: true });
        writeFileSync(
          target,
          JSON.stringify(
            {
              meta: {
                run,
                clipId: clip.id,
                lane,
                started,
                elapsedMs: Math.round(performance.now() - t),
              },
              raw,
            },
            null,
            2,
          ),
        );
        console.log(`done ${run.id} ${clip.id}.${lane}`);
      }
    }
  }
}

async function runStreams(): Promise<void> {
  const speed = Number(values.speed);
  for (const run of loadRuns('stream')) {
    const provider = streamProvider(run.options);
    for (const clip of loadManifest()) {
      for (const { lane, path } of lanesOf(clip, run)) {
        const audio = readWav(path);
        assertSpeechFormat(audio, path);
        const log = outPath('stream', run.id, `${clip.id}.${lane}.jsonl`);
        mkdirSync(dirname(log), { recursive: true });
        writeFileSync(
          `${log}.meta.json`,
          JSON.stringify(
            { run, clipId: clip.id, lane, started: new Date().toISOString(), speed },
            null,
            2,
          ),
        );
        console.log(
          `stream ${run.id} ${clip.id}.${lane} (${Math.round(audio.durationMs / 1000)} s at ${speed}×)`,
        );
        await runStream(
          provider,
          run.options,
          audio,
          { clipId: clip.id, lane, vocabulary: clip.vocabulary },
          log,
          speed,
        );
      }
    }
  }
}

function readStreamLog(path: string): StreamLogLine[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => StreamLogLine.parse(JSON.parse(l)));
}

function hypothesisFromLog(log: StreamLogLine[]): Hypothesis {
  const finals = log.filter((l) => l.kind === 'final');
  return {
    text: finals.map((f) => f.text).join(' '),
    words: finals.flatMap((f) => f.words ?? []),
    segments: finals.map((f) => ({
      text: f.text,
      ...(f.start !== undefined ? { start: f.start } : {}),
      ...(f.end !== undefined ? { end: f.end } : {}),
    })),
  };
}

function loadReference(clipId: string, lane: 'me' | 'them'): Reference | undefined {
  const p = join(dataDir(), 'refs', `${clipId}.${lane}.json`);
  return existsSync(p) ? Reference.parse(JSON.parse(readFileSync(p, 'utf8'))) : undefined;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function score(): void {
  const list = loadCanonicalList();
  const norm = new Normalizer({ list });
  const rawNorm = new Normalizer({ list, canonicalize: false });
  const rows: Record<string, unknown>[] = [];
  for (const run of loadRuns()) {
    for (const clip of loadManifest()) {
      for (const { lane, path } of lanesOf(clip, run)) {
        const ref = loadReference(clip.id, lane);
        if (!ref) continue;
        let hyp: Hypothesis;
        let latency: ReturnType<typeof analyseStream> | undefined;
        if (run.mode === 'batch') {
          const p = outPath('raw', run.id, `${clip.id}.${lane}.json`);
          if (!existsSync(p)) continue;
          const { raw } = JSON.parse(readFileSync(p, 'utf8')) as { raw: unknown };
          hyp = batchProvider(run.options).toHypothesis(raw);
        } else {
          const p = outPath('stream', run.id, `${clip.id}.${lane}.jsonl`);
          if (!existsSync(p)) continue;
          const log = readStreamLog(p);
          hyp = hypothesisFromLog(log);
          latency = analyseStream(log, detectSpeech(readWav(path).data));
        }
        const prepRef = prepareReference(ref, norm);
        const prepHyp = prepareHypothesis(hyp, norm);
        const { score: s, ops } = scoreText(ref, prepRef, prepHyp);
        const raw = scoreText(
          ref,
          prepareReference(ref, rawNorm),
          prepareHypothesis(hyp, rawNorm),
        ).score;
        const halluc = hallucinationRate(ref, prepHyp);
        const hypTurns = turnsFromWords(hyp.words.length ? hyp.words : hyp.segments);
        const der =
          lane === 'them' && ref.turns.length && hypTurns.length
            ? diarizationErrorRate(ref.turns, hypTurns)
            : undefined;
        const themRef = lane === 'me' ? loadReference(clip.id, 'them') : undefined;
        rows.push({
          run: run.id,
          provider: run.options.provider,
          mode: run.mode,
          clip: clip.id,
          lane,
          refTokens: s.counts.refLength,
          wer: s.wer,
          werRaw: raw.wer,
          werPhonetic: s.werPhonetic,
          cer: s.cer,
          werHi: s.werByLang.hi,
          werEn: s.werByLang.en,
          codeSwitchWer: s.codeSwitchWer,
          entityAcc: s.entityAccuracy.overall,
          entityPerson: s.entityAccuracy.byType.person,
          entityNumber: s.entityAccuracy.byType.number,
          entityMoney: s.entityAccuracy.byType.money,
          entityDate: s.entityAccuracy.byType.date,
          entityTerm: s.entityAccuracy.byType.term,
          hallucPerMin: halluc.perMinute,
          echoWords: themRef
            ? echoLeakage(ops, prepHyp, prepareReference(themRef, norm))
            : undefined,
          der: der?.der,
          hypSpeakers: der?.hypSpeakers,
          interimP50: latency?.interimP50,
          interimP90: latency?.interimP90,
          finalP50: latency?.finalP50,
          finalP90: latency?.finalP90,
          instability: latency?.interimInstability,
          rotations: latency?.rotations,
        });
      }
    }
  }
  if (rows.length === 0) throw new Error('Nothing to score: no references or raw outputs found.');
  const headers = Object.keys(rows[0] ?? {});
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(',')),
  ].join('\n');
  mkdirSync(outPath(), { recursive: true });
  const target = outPath(values.out ?? 'scores.csv');
  writeFileSync(target, `${csv}\n`);
  console.log(`Wrote ${target} (${rows.length} rows)`);
}

function blindSamples(): void {
  const runs = loadRuns();
  const out: string[] = [
    '# Display readability ratings (Phase G)',
    '',
    'Rate each sample 1–5 for readability and naturalness. Do not open key.json until both raters finish.',
    '',
  ];
  const key: Record<string, string> = {};
  for (const clip of loadManifest().filter((c) => c.set === 'subset')) {
    const samples: { run: string; text: string }[] = [];
    for (const run of runs) {
      const lane = 'them';
      let hyp: Hypothesis | undefined;
      const batchPath = outPath('raw', run.id, `${clip.id}.${lane}.json`);
      const streamPath = outPath('stream', run.id, `${clip.id}.${lane}.jsonl`);
      if (run.mode === 'batch' && existsSync(batchPath)) {
        hyp = batchProvider(run.options).toHypothesis(
          (JSON.parse(readFileSync(batchPath, 'utf8')) as { raw: unknown }).raw,
        );
      } else if (run.mode === 'stream' && existsSync(streamPath)) {
        hyp = hypothesisFromLog(readStreamLog(streamPath));
      }
      if (hyp) samples.push({ run: run.id, text: transliterate(hyp.text).slice(0, 1200) });
    }
    samples.sort(() => Math.random() - 0.5);
    out.push(`## Clip ${clip.id}`, '');
    samples.forEach((s, i) => {
      const label = `${clip.id}-${String.fromCharCode(65 + i)}`;
      key[label] = s.run;
      out.push(
        `### Sample ${label}`,
        '',
        s.text,
        '',
        'Readability (1–5): ___   Naturalness (1–5): ___',
        '',
      );
    });
  }
  mkdirSync(outPath('ratings'), { recursive: true });
  writeFileSync(outPath('ratings', 'samples.md'), out.join('\n'));
  writeFileSync(outPath('ratings', 'key.json'), JSON.stringify(key, null, 2));
  console.log(`Wrote ${outPath('ratings')}`);
}

function timeConnect(host: string): Promise<{ tls: number; firstByte: number }> {
  return new Promise((resolveP, reject) => {
    const t0 = performance.now();
    let tls = 0;
    const req = request(
      { host, path: '/', method: 'HEAD', agent: false, timeout: 10_000 },
      (res) => {
        res.resume();
        resolveP({ tls, firstByte: performance.now() - t0 });
      },
    );
    req.on('socket', (s) => s.once('secureConnect', () => (tls = performance.now() - t0)));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function measureLatency(): Promise<void> {
  const hosts = ['api.sarvam.ai', 'api.deepgram.com', 'generativelanguage.googleapis.com'];
  console.log('host,attempt,tls_ms,first_byte_ms');
  for (const host of hosts) {
    for (let i = 1; i <= 5; i++) {
      try {
        const r = await timeConnect(host);
        console.log(`${host},${i},${r.tls.toFixed(0)},${r.firstByte.toFixed(0)}`);
      } catch (e) {
        console.log(`${host},${i},error,${(e as Error).message}`);
      }
    }
  }
}

const commands: Record<string, () => Promise<void> | void> = {
  'run-batch': runBatch,
  'run-stream': runStreams,
  score,
  'blind-samples': blindSamples,
  'measure-latency': measureLatency,
  summarize: () =>
    console.log(summarizeScores(readFileSync(outPath(values.out ?? 'scores.csv'), 'utf8'))),
  'import-kaldi': () => {
    if (!values.src) throw new Error('--src is required');
    const log = importKaldi({
      src: resolve(values.src),
      dataDir: dataDir(),
      prefix: values.prefix ?? 'kx',
      limit: Number(values.limit),
      maxSeconds: Number(values['max-seconds']),
      scenario: values.scenario ?? 'Kaldi import',
    });
    console.log(log.join('\n'));
  },
};

const command = positionals[0];
if (values.help || !command || !commands[command]) {
  console.log(USAGE);
  process.exit(command && !values.help ? 1 : 0);
}
try {
  await commands[command]?.();
} catch (e) {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
}
