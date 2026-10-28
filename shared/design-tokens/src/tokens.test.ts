import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.ts';
import { buildTokensCss, cssVarName } from './css.ts';
import { darkColors, lightColors, type ColorToken } from './tokens.ts';

type Pair = [fg: ColorToken, bg: ColorToken, min: number, why: string];

// Text pairs need 4.5:1, control boundaries 3:1 (WCAG 2.2 AA, DESIGN §20).
const pairs: Pair[] = [
  ['ink', 'surface', 4.5, 'body text'],
  ['ink', 'paper', 4.5, 'body text on page'],
  ['muted', 'surface', 4.5, 'AI text, meta, interim transcript'],
  ['muted', 'paper', 4.5, 'meta on page'],
  ['muted', 'paper2', 4.5, 'composer and sidebar meta'],
  ['ink3', 'surface', 4.5, 'secondary body'],
  ['onOlive', 'olive', 4.5, 'primary button label'],
  ['olive', 'surface', 4.5, 'links and ghost buttons'],
  ['oliveInk', 'oliveTint', 4.5, 'selected chips, Ready pill'],
  ['warnInk', 'warnBg', 4.5, 'Writing notes pill'],
  ['amberInk', 'amberBg', 4.5, 'degraded banners'],
  ['danger', 'surface', 4.5, 'destructive text'],
  ['danger', 'dangerBg', 4.5, 'failed pill'],
  ['controlLine', 'surface', 3, 'input, checkbox, switch boundaries'],
  ['oliveLine', 'surface', 3, 'focus ring'],
];

describe('contrast', () => {
  it('computes known WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  for (const [theme, colors] of [
    ['light', lightColors],
    ['dark', darkColors],
  ] as const) {
    for (const [fg, bg, min, why] of pairs) {
      it(`${theme}: ${fg} on ${bg} ≥ ${min}:1 (${why})`, () => {
        expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(min);
      });
    }
  }
});

describe('tokens.css', () => {
  it('is up to date with tokens.ts', () => {
    const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');
    expect(css).toBe(buildTokensCss());
  });

  it('names variables in kebab case', () => {
    expect(cssVarName('paper2')).toBe('--paper-2');
    expect(cssVarName('oliveHl')).toBe('--olive-hl');
    expect(cssVarName('controlLine')).toBe('--control-line');
  });
});

describe('fonts.css', () => {
  it('only imports files that exist in the installed font packages', () => {
    const require = createRequire(import.meta.url);
    const css = readFileSync(fileURLToPath(new URL('./fonts.css', import.meta.url)), 'utf8');
    const imports = [...css.matchAll(/@import '([^']+)'/g)].map((m) => m[1] ?? '');
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(existsSync(require.resolve(spec)), spec).toBe(true);
  });
});
