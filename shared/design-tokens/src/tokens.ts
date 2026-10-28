/**
 * Design tokens from DESIGN.md §5 (light) and §16 (dark). tokens.css mirrors these values;
 * tokens.test.ts keeps the two in sync and checks WCAG contrast.
 */

export const lightColors = {
  paper: '#f6f5ef',
  paper2: '#fbfaf6',
  surface: '#ffffff',
  ink: '#11120e',
  ink2: '#2a2b26',
  ink3: '#4a4b44',
  muted: '#6b6b65',
  hairline: '#e4e3dc',
  hairline2: '#eeede6',
  stroke: '#d6d5cf',
  controlLine: '#8a8a83',
  strokeOff: '#c9c8c1',
  olive: '#566a0a',
  oliveHover: '#46570a',
  oliveInk: '#3f4e05',
  oliveLine: '#7a8c1f',
  oliveTint: '#e7ebd2',
  oliveWash: '#f3f5e6',
  oliveHl: '#eef2dc',
  matchHl: '#e2e8c4',
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
} as const;

export type ColorToken = keyof typeof lightColors;

/** Dark appearance (DESIGN §16). Tokens not listed keep their light value. */
export const darkColors: Record<ColorToken, string> = {
  ...lightColors,
  paper: '#141511',
  paper2: '#1a1b16',
  surface: '#1f201b',
  ink: '#f2f1ea',
  ink2: '#dcdbd3',
  ink3: '#c4c3bb',
  muted: '#a5a59d',
  hairline: '#2e2f28',
  hairline2: '#262720',
  stroke: '#3a3b34',
  controlLine: '#77776f',
  strokeOff: '#4a4b44',
  olive: '#8aa12a',
  oliveHover: '#9bb33a',
  oliveInk: '#d6e3a0',
  oliveLine: '#a3b84a',
  oliveTint: '#2a3112',
  oliveWash: '#23281a',
  oliveHl: '#2d3416',
  matchHl: '#3a4419',
  warnBg: '#3a2119',
  warnInk: '#f2b8a6',
  amberBg: '#33270f',
  amberInk: '#f0c27a',
  danger: '#e07a62',
  dangerHover: '#ea9580',
  dangerBg: '#3a1f19',
  onOlive: '#11120e',
};

export const fonts = {
  serif: '"Newsreader", "Noto Serif Devanagari", Georgia, serif',
  sans: '"DM Sans", "Noto Sans Devanagari", system-ui, sans-serif',
} as const;

/** DESIGN §5.2 — [size px, line-height, weight, letter-spacing em]. */
export const typeScale = {
  display: [50, 1.05, 400, -0.02],
  meetingTitle: [46, 1.05, 400, -0.02],
  panelH3: [26, 1.2, 400, 0],
  h2: [26, 1.2, 400, 0],
  noteH3: [25, 1.25, 400, 0],
  cardTitle: [21, 1.25, 400, 0],
  quote: [19, 1.4, 400, 0],
  body: [15, 1.55, 400, 0.01],
  overview: [16, 1.6, 400, 0.01],
  liveTranscript: [14, 1.5, 400, 0.01],
  label: [14, 1.3, 500, 0.01],
  meta: [12, 1.4, 400, 0.01],
  overline: [11, 1.3, 400, 0.08],
  speaker: [12, 1.3, 600, 0.01],
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

/** Lucide icon names used by the UI (DESIGN §5.8); SVGs are bundled by the UI packages. */
export const icons = [
  'house',
  'align-left',
  'square-check',
  'settings',
  'search',
  'x',
  'chevron-left',
  'chevron-right',
  'refresh-cw',
  'more-horizontal',
  'shield',
  'download',
  'arrow-up',
  'check',
  'play',
  'pause',
  'mic',
  'alert-triangle',
  'wifi-off',
  'pencil',
  'star',
] as const;
