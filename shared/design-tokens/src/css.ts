import { darkColors, fonts, lightColors, radius } from './tokens.ts';

/** camelCase token name → CSS custom property name, e.g. paper2 → --paper-2, oliveHl → --olive-hl. */
export function cssVarName(token: string): string {
  return `--${token
    .replace(/([A-Z])/g, '-$1')
    .replace(/(\d+)/g, '-$1')
    .toLowerCase()}`;
}

function block(colors: Record<string, string>, indent: string): string {
  return Object.entries(colors)
    .map(([k, v]) => `${indent}${cssVarName(k)}: ${v};`)
    .join('\n');
}

/** Builds tokens.css. Dark mode follows the system unless a page forces a theme (DESIGN §16). */
export function buildTokensCss(): string {
  const radii = Object.entries(radius)
    .map(([k, v]) => `  ${cssVarName(`radius-${k}`)}: ${v}px;`)
    .join('\n');
  return `/* Generated from tokens.ts by \`pnpm --filter @meetyou/design-tokens build:css\`. Do not edit. */
:root {
  color-scheme: light dark;
${block(lightColors, '  ')}
  --font-serif: ${fonts.serif};
  --font-sans: ${fonts.sans};
${radii}
  --glass-bg: rgba(251, 250, 246, 0.62);
  --glass-sheet-bg: rgba(251, 250, 246, 0.78);
  --glass-blur: blur(22px) saturate(1.7);
  --glass-edge: rgba(255, 255, 255, 0.75);
  --glass-shadow: 0 12px 40px rgba(17, 18, 14, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.7);
  --scrim: rgba(17, 18, 14, 0.28);
  --focus-ring: 2px solid var(--olive-line);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${block(darkColors, '    ')}
    --glass-bg: rgba(31, 32, 27, 0.6);
    --glass-sheet-bg: rgba(31, 32, 27, 0.78);
    --glass-edge: rgba(255, 255, 255, 0.08);
  }
}

:root[data-theme='dark'] {
${block(darkColors, '  ')}
  --glass-bg: rgba(31, 32, 27, 0.6);
  --glass-sheet-bg: rgba(31, 32, 27, 0.78);
  --glass-edge: rgba(255, 255, 255, 0.08);
}

@media (prefers-reduced-transparency: reduce) {
  :root {
    --glass-bg: var(--surface);
    --glass-sheet-bg: var(--surface);
    --glass-blur: none;
    --glass-edge: var(--stroke);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;
}
