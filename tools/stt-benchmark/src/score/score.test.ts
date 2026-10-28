import { describe, expect, it } from 'vitest';
import { Normalizer, loadCanonicalList } from '../normalize/index.ts';
import { Reference, type StreamLogLine } from '../schemas.ts';
import { align, cer, countErrors, errorRate } from './align.ts';
import { diarizationErrorRate, turnsFromWords } from './der.ts';
import { analyseStream, detectSpeech } from './latency.ts';
import {
  echoLeakage,
  hallucinationRate,
  prepareHypothesis,
  prepareReference,
  scoreText,
} from './metrics.ts';

const norm = new Normalizer({ list: loadCanonicalList() });

describe('alignment', () => {
  it('counts substitutions, deletions and insertions', () => {
    const ops = align(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    const c = countErrors(ops, 4);
    expect(c).toEqual({ sub: 1, del: 0, ins: 1, refLength: 4 });
    expect(errorRate(c)).toBe(0.5);
    expect(countErrors(align(['a', 'b'], []), 2).del).toBe(2);
  });

  it('computes CER', () => {
    expect(cer(['abcd'], ['abed'])).toBeCloseTo(0.25);
    expect(cer([], [])).toBe(0);
  });
});

const reference = Reference.parse({
  clipId: 'hx-001',
  lane: 'them',
  words: [
    { text: 'kal', lang: 'hi', start: 0.0, end: 0.3 },
    { text: 'ka', lang: 'hi', start: 0.3, end: 0.5 },
    { text: 'deployment', lang: 'en', start: 0.5, end: 1.1 },
    { text: 'push', lang: 'en', start: 1.1, end: 1.4 },
    { text: 'kar', lang: 'hi', start: 1.4, end: 1.6 },
    { text: 'dete', lang: 'hi', start: 1.6, end: 1.8 },
    { text: 'hain', lang: 'hi', start: 1.8, end: 2.0 },
    { text: 'um', lang: 'other', filler: true },
    { text: 'Rahul', lang: 'hi', start: 2.5, end: 2.8 },
    { text: 'Mehta', lang: 'hi', start: 2.8, end: 3.1 },
  ],
  entities: [{ type: 'person', startWord: 8, endWord: 9 }],
  nonSpeech: [{ start: 4, end: 10 }],
});

describe('text scoring', () => {
  const prepRef = prepareReference(reference, norm);

  it('drops fillers from the reference', () => {
    expect(prepRef.tokens).not.toContain('um');
    expect(prepRef.tokens).toHaveLength(9);
  });

  it('scores a perfect Devanagari-mixed hypothesis as zero WER', () => {
    const hyp = prepareHypothesis(
      { text: 'कल का deployment push कर देते हैं Rahul Mehta', words: [], segments: [] },
      norm,
    );
    const { score } = scoreText(reference, prepRef, hyp);
    expect(score.wer).toBe(0);
    expect(score.entityAccuracy.overall).toBe(1);
  });

  it('attributes errors to language and code-switch windows and entities', () => {
    const hyp = prepareHypothesis(
      { text: 'kal ka development push kar dete hain rahul mehra', words: [], segments: [] },
      norm,
    );
    const { score } = scoreText(reference, prepRef, hyp);
    expect(score.counts.sub).toBe(2);
    expect(score.werByLang.en).toBe(0.5);
    expect(score.codeSwitchWer).not.toBeNull();
    expect(score.codeSwitchWer ?? 0).toBeGreaterThan(0);
    expect(score.entityAccuracy.byType.person).toBe(0);
  });

  it('measures hallucinations in non-speech regions', () => {
    const hyp = prepareHypothesis(
      {
        text: '',
        words: [
          { text: 'thank', start: 5, end: 5.3 },
          { text: 'you', start: 5.3, end: 5.5 },
        ],
        segments: [],
      },
      norm,
    );
    const h = hallucinationRate(reference, hyp);
    expect(h.words).toBe(2);
    expect(h.perMinute).toBeCloseTo(20);
  });

  it('detects echo of remote speech in the me lane', () => {
    const meRef = Reference.parse({
      clipId: 'hx-001',
      lane: 'me',
      words: [{ text: 'theek', lang: 'hi' }],
    });
    const mePrep = prepareReference(meRef, norm);
    const meHyp = prepareHypothesis(
      {
        text: '',
        words: [
          { text: 'theek', start: 0, end: 0.2 },
          { text: 'deployment', start: 0.6, end: 1 },
        ],
        segments: [],
      },
      norm,
    );
    const { ops } = scoreText(meRef, mePrep, meHyp);
    expect(echoLeakage(ops, meHyp, prepRef)).toBe(1);
  });
});

describe('diarization', () => {
  const ref = [
    { speaker: 'A', start: 0, end: 5 },
    { speaker: 'B', start: 5, end: 10 },
  ];

  it('is zero for a relabelled perfect hypothesis', () => {
    const hyp = [
      { speaker: 'spk_2', start: 0, end: 5 },
      { speaker: 'spk_1', start: 5, end: 10 },
    ];
    expect(diarizationErrorRate(ref, hyp).der).toBeCloseTo(0);
  });

  it('counts confusion when one speaker is merged', () => {
    const r = diarizationErrorRate(ref, [{ speaker: 'x', start: 0, end: 10 }]);
    expect(r.der ?? 0).toBeGreaterThan(0.4);
    expect(r.der ?? 1).toBeLessThan(0.6);
  });

  it('builds turns from labelled words', () => {
    expect(
      turnsFromWords([
        { text: 'a', start: 0, end: 1, speaker: '0' },
        { text: 'b', start: 1.1, end: 2, speaker: '0' },
        { text: 'c', start: 2.2, end: 3, speaker: '1' },
      ] as never),
    ).toEqual([
      { speaker: '0', start: 0, end: 2 },
      { speaker: '1', start: 2.2, end: 3 },
    ]);
  });
});

describe('streaming latency', () => {
  function tone(ms: number, amp: number): Buffer {
    const n = (16000 * ms) / 1000;
    const b = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * 32767 * Math.sin(i / 5)), i * 2);
    return b;
  }

  it('finds speech segments by energy', () => {
    const pcm = Buffer.concat([tone(1000, 0), tone(1000, 0.3), tone(1000, 0)]);
    const segs = detectSpeech(pcm);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.startMs).toBeGreaterThanOrEqual(980);
    expect(segs[0]?.endMs).toBeLessThanOrEqual(2020);
  });

  it('computes interim/final latency and instability', () => {
    const log: StreamLogLine[] = [];
    for (let a = 100; a <= 3000; a += 100) log.push({ kind: 'sent', t: a, audioMs: a });
    log.push({ kind: 'interim', t: 1300, text: 'kal ka' });
    log.push({ kind: 'interim', t: 1600, text: 'kal ka deploy' });
    log.push({ kind: 'final', t: 2600, text: 'kal ka deployment' });
    log.push({ kind: 'session', t: 2700, event: 'rotate' });
    const r = analyseStream(log, [{ startMs: 1000, endMs: 2000 }]);
    expect(r.interimP50).toBe(300);
    expect(r.finalP50).toBe(600);
    expect(r.interimInstability).toBeCloseTo(1 / 3 + 1 / 3);
    expect(r.rotations).toBe(1);
  });
});
