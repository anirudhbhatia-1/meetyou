/**
 * Design tokens from DESIGN.md §5 (light) and §16 (dark). tokens.css mirrors these values;
 * tokens.test.ts keeps the two in sync and checks WCAG contrast.
 */

/**
 * Brand colour: the **Moonrise** gradient #dae2f8 → #d6a4a4 since 2026-11-09 (Anirudh), replacing
 * orange. Both ends are too light for text or for white labels (#d6a4a4 is 2.2:1 on white), so:
 * the gradient is the page backdrop (softened 50% toward white) and one full-strength signature
 * band; the accent (`olive*` tokens, names kept so components keep working) is a deep rose from the
 * same family, used for primary actions, links, focus and selection. Neutrals lean cool to match the
 * blue end. The recording ember and the amber/warn/danger signals keep their own meanings.
 */
export const lightColors = {
  paper: '#f5f4fa',
  paper2: '#fafafd',
  surface: '#ffffff',
  ink: '#14141c',
  ink2: '#2a2a34',
  ink3: '#45454f',
  muted: '#585863',
  hairline: '#e4e3ec',
  hairline2: '#eeedf4',
  stroke: '#d6d5df',
  controlLine: '#868692',
  strokeOff: '#c9c8d3',
  olive: '#8c4a5c',
  oliveHover: '#743c4c',
  oliveInk: '#6b3446',
  oliveLine: '#a86b7c',
  oliveTint: '#f3e4ea',
  oliveWash: '#f5eff6',
  oliveHl: '#f8eaee',
  matchHl: '#efd3da',
  ember: '#e0603f',
  emberLine: '#bd4a30',
  emberHalo: '#f9dcd2',
  warnBg: '#fdeee8',
  warnInk: '#9a3d26',
  amberDot: '#d48a1c',
  amberBg: '#fdf3e1',
  amberInk: '#7a4a05',
  danger: '#b3412a',
  dangerHover: '#9a3522',
  dangerBg: '#fbe7e2',
  onOlive: '#ffffff',
  /** Moonrise at full strength: the signature band (no small muted text on it). */
  moonriseFrom: '#dae2f8',
  moonriseTo: '#d6a4a4',
  /** Moonrise softened 50% toward white: the page backdrop behind cards. */
  backdropFrom: '#ecf0fc',
  backdropTo: '#ead2d2',
} as const;

export type ColorToken = keyof typeof lightColors;

/** Dark appearance (DESIGN §16): Moonrise at night, deep blue to plum. */
export const darkColors: Record<ColorToken, string> = {
  ...lightColors,
  paper: '#121319',
  paper2: '#181920',
  surface: '#1d1e26',
  ink: '#f1f0f6',
  ink2: '#dddce4',
  ink3: '#c5c4cd',
  muted: '#a3a2ad',
  hairline: '#2c2d36',
  hairline2: '#24252d',
  stroke: '#383943',
  controlLine: '#7d7d89',
  strokeOff: '#484954',
  olive: '#e7b4bd',
  oliveHover: '#f0c9cf',
  oliveInk: '#f3d3d9',
  oliveLine: '#d295a1',
  oliveTint: '#3a2832',
  oliveWash: '#2a222c',
  oliveHl: '#3a2a33',
  matchHl: '#4a2f3a',
  warnBg: '#3a2119',
  warnInk: '#f2b8a6',
  amberBg: '#33270f',
  amberInk: '#f0c27a',
  danger: '#e07a62',
  dangerHover: '#ea9580',
  dangerBg: '#3a1f19',
  onOlive: '#14141c',
  moonriseFrom: '#2a3150',
  moonriseTo: '#4a2f35',
  backdropFrom: '#161925',
  backdropTo: '#231a20',
};

export const fonts = {
  serif: '"Newsreader", "Noto Serif Devanagari", Georgia, serif',
  sans: '"DM Sans", "Noto Sans Devanagari", system-ui, sans-serif',
} as const;

export const space = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 72, 96] as const;

export const radius = {
  card: 16,
  inner: 12,
  row: 10,
  checkbox: 7,
  prompt: 18,
  sheet: 22,
  alert: 20,
  menu: 14,
  menuItem: 9,
  pill: 999,
} as const;

/** Milliseconds (DESIGN §5.7). */
export const motion = {
  hover: 150,
  state: 200,
  progress: 400,
  regenerateFade: 300,
  recordingPulse: 1600,
  processingPulse: 1200,
} as const;
