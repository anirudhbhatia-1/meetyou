import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildWav } from '../wav.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/** Two seconds of tone followed by one second of silence (16 kHz mono PCM16). */
function toneWav(): Buffer {
  const pcm = Buffer.alloc(16000 * 3 * 2);
  for (let i = 0; i < 16000 * 2; i++) pcm.writeInt16LE(Math.round(9000 * Math.sin(i / 6)), i * 2);
  return buildWav(pcm);
}

function setupDataDir(): { dir: string; config: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bench-cli-'));
  for (const sub of ['audio', 'refs', 'results/raw/dg-batch', 'results/stream/sv-stream']) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  writeFileSync(join(dir, 'audio/c1.them.wav'), toneWav());
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ clips: [{ id: 'c1', set: 'subset', lanes: { them: 'audio/c1.them.wav' } }] }),
  );
  writeFileSync(
    join(dir, 'refs/c1.them.json'),
    JSON.stringify({
      clipId: 'c1',
      lane: 'them',
      words: [
        { text: 'kal', lang: 'hi' },
        { text: 'deployment', lang: 'en' },
        { text: 'karte', lang: 'hi' },
        { text: 'hain', lang: 'hi' },
      ],
    }),
  );
  writeFileSync(
    join(dir, 'results/raw/dg-batch/c1.them.json'),
    JSON.stringify({
      meta: {},
      raw: {
        results: {
          channels: [
            {
              alternatives: [
                {
                  transcript: 'kal deployment karte hain',
                  words: [
                    { word: 'kal', start: 0, end: 0.3, speaker: 0 },
                    { word: 'deployment', start: 0.3, end: 0.9, speaker: 0 },
                    { word: 'karte', start: 0.9, end: 1.2, speaker: 0 },
                    { word: 'hain', start: 1.2, end: 1.5, speaker: 0 },
                  ],
                },
              ],
            },
          ],
        },
      },
    }),
  );
  const log = [
    ...Array.from({ length: 30 }, (_, i) => ({
      kind: 'sent',
      t: (i + 1) * 100,
      audioMs: (i + 1) * 100,
    })),
    { kind: 'interim', t: 400, text: 'कल' },
    { kind: 'final', t: 2400, text: 'कल deployment करते हैं', utteranceId: '0' },
  ];
  writeFileSync(
    join(dir, 'results/stream/sv-stream/c1.them.jsonl'),
    log.map((l) => JSON.stringify(l)).join('\n'),
  );
  const config = join(dir, 'runs.json');
  writeFileSync(
    config,
    JSON.stringify({
      runs: [
        { id: 'dg-batch', mode: 'batch', lanes: ['them'], options: { provider: 'deepgram' } },
        { id: 'sv-stream', mode: 'stream', lanes: ['them'], options: { provider: 'sarvam' } },
      ],
    }),
  );
  return { dir, config };
}

describe('bench CLI', () => {
  it('scores batch and stream outputs end to end into scores.csv', () => {
    const { dir, config } = setupDataDir();
    execFileSync(process.execPath, [MAIN, 'score', '--config', config], {
      env: { ...process.env, BENCH_DATA_DIR: dir },
      stdio: 'pipe',
    });
    const [header, ...rows] = readFileSync(join(dir, 'results/scores.csv'), 'utf8')
      .trim()
      .split('\n');
    const cols = (header ?? '').split(',');
    const get = (row: string, col: string) => row.split(',')[cols.indexOf(col)];
    expect(rows).toHaveLength(2);
    const batch = rows.find((r) => r.startsWith('dg-batch')) ?? '';
    const stream = rows.find((r) => r.startsWith('sv-stream')) ?? '';
    expect(get(batch, 'wer')).toBe('0');
    // Devanagari stream output scores 0 after transliteration + canonical spelling.
    expect(get(stream, 'wer')).toBe('0');
    expect(Number(get(stream, 'finalP50'))).toBeGreaterThan(0);
  });

  it('refuses to send audio when a data-use guard is not confirmed', () => {
    const { dir } = setupDataDir();
    const config = join(dir, 'gemini.json');
    writeFileSync(
      config,
      JSON.stringify({
        runs: [{ id: 'g', mode: 'batch', lanes: ['them'], options: { provider: 'gemini' } }],
      }),
    );
    const env: NodeJS.ProcessEnv = { ...process.env, BENCH_DATA_DIR: dir };
    delete env.GEMINI_BILLING_ENABLED;
    const r = spawnSync(process.execPath, [MAIN, 'run-batch', '--config', config], {
      env,
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/GEMINI_BILLING_ENABLED=true/);
  });
});

describe('summarize', () => {
  it('weights accuracy by reference tokens and takes latency medians', async () => {
    const { summarizeScores } = await import('./extras.ts');
    const csv = [
      'run,refTokens,wer,werPhonetic,cer,werHi,werEn,codeSwitchWer,hallucPerMin,interimP50,finalP50,finalP90',
      'a,100,0.1,0.05,0.04,0.1,0.1,0.2,,300,600,900',
      'a,300,0.3,0.15,0.08,0.3,0.3,0.4,,500,700,1000',
    ].join('\n');
    const table = summarizeScores(csv);
    expect(table).toContain('| a | 2 | 25.0% | 12.5% | 7.0% |');
    expect(table).toContain('| 700 | 1000 |');
  });
});
