import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Token-weighted mean of a numeric CSV column (empty cells are skipped). */
function weighted(rows: Record<string, string>[], col: string): number | null {
  let sum = 0;
  let weight = 0;
  for (const r of rows) {
    const v = r[col];
    const w = Number(r.refTokens);
    if (v === undefined || v === '' || !Number.isFinite(w)) continue;
    sum += Number(v) * w;
    weight += w;
  }
  return weight === 0 ? null : sum / weight;
}

function median(rows: Record<string, string>[], col: string): number | null {
  const v = rows
    .map((r) => r[col])
    .filter((x): x is string => x !== undefined && x !== '')
    .map(Number)
    .sort((a, b) => a - b);
  return v.length === 0 ? null : (v[Math.floor(v.length / 2)] ?? null);
}

export function parseCsv(text: string): Record<string, string>[] {
  const [head, ...lines] = text.trim().split('\n');
  const cols = (head ?? '').split(',');
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}

/** One Markdown row per run: token-weighted accuracy and median latency (for ADR-0001). */
export function summarizeScores(csv: string): string {
  const rows = parseCsv(csv);
  const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)}`);
  const out = [
    '| Run | Clips | WER | WER (spelling-insensitive) | CER | WER hi | WER en | Code-switch WER | Halluc./min | Interim P50 ms | Final P50 ms | Final P90 ms |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const run of [...new Set(rows.map((r) => r.run ?? ''))].sort()) {
    const rr = rows.filter((r) => r.run === run);
    const halluc = median(rr, 'hallucPerMin');
    out.push(
      `| ${run} | ${rr.length} | ${pct(weighted(rr, 'wer'))} | ${pct(weighted(rr, 'werPhonetic'))} | ${pct(weighted(rr, 'cer'))} | ${pct(weighted(rr, 'werHi'))} | ${pct(weighted(rr, 'werEn'))} | ${pct(weighted(rr, 'codeSwitchWer'))} | ${halluc === null ? '—' : halluc.toFixed(2)} | ${ms(median(rr, 'interimP50'))} | ${ms(median(rr, 'finalP50'))} | ${ms(median(rr, 'finalP90'))} |`,
    );
  }
  return out.join('\n');
}

/**
 * Imports a Kaldi-format corpus (wav.scp-style folder with transcripts/segments and
 * transcripts/text) as benchmark clips: the first `maxSeconds` of each of `limit` recordings,
 * converted to 16 kHz mono PCM16, with references tagged hi/en by script.
 */
export function importKaldi(opts: {
  src: string;
  dataDir: string;
  prefix: string;
  limit: number;
  maxSeconds: number;
  scenario: string;
}): string[] {
  const text = new Map<string, string>();
  for (const line of readFileSync(join(opts.src, 'transcripts/text'), 'utf8').split('\n')) {
    const i = line.indexOf(' ');
    if (i > 0) text.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  const segs = new Map<string, { start: number; end: number; utt: string }[]>();
  for (const line of readFileSync(join(opts.src, 'transcripts/segments'), 'utf8').split('\n')) {
    const [utt, rec, start, end] = line.trim().split(/\s+/);
    if (!utt || !rec || !start || !end) continue;
    const list = segs.get(rec) ?? [];
    list.push({ start: Number(start), end: Number(end), utt });
    segs.set(rec, list);
  }
  mkdirSync(join(opts.dataDir, 'audio'), { recursive: true });
  mkdirSync(join(opts.dataDir, 'refs'), { recursive: true });
  const clips: unknown[] = [];
  const log: string[] = [];
  [...segs.keys()]
    .sort()
    .slice(0, opts.limit)
    .forEach((rec, idx) => {
      const id = `${opts.prefix}-${String(idx + 1).padStart(3, '0')}`;
      const chosen = (segs.get(rec) ?? [])
        .sort((a, b) => a.start - b.start)
        .filter((s) => s.end <= opts.maxSeconds);
      const cut = chosen[chosen.length - 1]?.end ?? opts.maxSeconds;
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-y',
        '-i',
        join(opts.src, `${rec}.wav`),
        '-t',
        cut.toFixed(2),
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        join(opts.dataDir, 'audio', `${id}.them.wav`),
      ]);
      const words: { text: string; lang: 'hi' | 'en' | 'other' }[] = [];
      const nonSpeech: { start: number; end: number }[] = [];
      let prevEnd = 0;
      for (const s of chosen) {
        if (s.start - prevEnd >= 2) nonSpeech.push({ start: prevEnd, end: s.start });
        prevEnd = s.end;
        for (const w of (text.get(s.utt) ?? '').split(/\s+/).filter(Boolean)) {
          const lang = /[ऀ-ॿ]/.test(w) ? 'hi' : /[A-Za-z]/.test(w) ? 'en' : 'other';
          words.push({ text: w, lang });
        }
      }
      writeFileSync(
        join(opts.dataDir, 'refs', `${id}.them.json`),
        JSON.stringify(
          { clipId: id, lane: 'them', words, entities: [], turns: [], nonSpeech },
          null,
          1,
        ),
      );
      const en = words.filter((w) => w.lang === 'en').length;
      clips.push({
        id,
        set: 'core',
        lanes: { them: `audio/${id}.them.wav` },
        languageMix: `${en}/${words.length} Latin-script words`,
        participants: 1,
        scenario: `${opts.scenario} ${rec}`,
        vocabulary: [],
        consentRefs: [],
      });
      log.push(`${id} ${rec} ${cut.toFixed(0)}s ${words.length} words (${en} Latin)`);
    });
  writeFileSync(join(opts.dataDir, 'manifest.json'), JSON.stringify({ clips }, null, 2));
  return log;
}
