/**
 * Recording pill over Meet (DESIGN §8.4, §9): what it shows per recording state, and where it
 * sits. Pure, so it is unit-tested apart from the Shadow DOM in recording-pill.ts.
 */
export type PillTone = 'live' | 'paused' | 'warn' | 'error';

export interface PillView {
  label: string;
  tone: PillTone;
  /** mm:ss since start. Not shown while paused: the clock has no paused time yet (S4-05 TODO). */
  showTimer: boolean;
  /** 14 px `video` icon after the timer while the screen is being recorded. */
  showVideo: boolean;
}

/** Null hides the pill: before recording starts, while it finishes, and after. */
export function pillViewFor(status: string, video: string): PillView | null {
  const videoOn = video === 'recording';
  switch (status) {
    case 'recording':
      return { label: 'Taking notes', tone: 'live', showTimer: true, showVideo: videoOn };
    case 'paused':
      // Audio and video both pause (§8.4), so no video icon.
      return { label: 'Paused', tone: 'paused', showTimer: false, showVideo: false };
    case 'reconnecting':
      return {
        label: 'Reconnecting — audio saved',
        tone: 'warn',
        showTimer: false,
        showVideo: videoOn,
      };
    case 'error':
      return { label: 'Recording stopped', tone: 'error', showTimer: false, showVideo: false };
    default:
      return null;
  }
}

export type PillCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const DEFAULT_CORNER: PillCorner = 'top-left';

/** Distance from the viewport edges. Bottom corners sit above Meet's control bar. */
export const PILL_INSET = { side: 16, top: 16, bottom: 96 } as const;

/** Pointer travel (px) before a press on the pill counts as a drag instead of a click. */
export const DRAG_THRESHOLD_PX = 4;

/** Corner whose quadrant holds the pill's centre after a drag. */
export function nearestCorner(
  centerX: number,
  centerY: number,
  viewportWidth: number,
  viewportHeight: number,
): PillCorner {
  const vertical = centerY < viewportHeight / 2 ? 'top' : 'bottom';
  const horizontal = centerX < viewportWidth / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}`;
}

/** Inline position for the pill's host element in a corner. */
export function cornerPosition(
  corner: PillCorner,
): Record<'top' | 'right' | 'bottom' | 'left', string> {
  const top = corner.startsWith('top');
  const left = corner.endsWith('left');
  return {
    top: top ? `${PILL_INSET.top}px` : '',
    bottom: top ? '' : `${PILL_INSET.bottom}px`,
    left: left ? `${PILL_INSET.side}px` : '',
    right: left ? '' : `${PILL_INSET.side}px`,
  };
}

/** Remembered per Chrome profile in `chrome.storage.local` (§8.4 "position remembered per user"). */
export const PILL_LAYOUT_KEY = 'pill.layout';

export interface PillLayout {
  corner: PillCorner;
  collapsed: boolean;
}

const CORNERS = new Set<string>(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

export function parsePillLayout(value: unknown): PillLayout {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    corner:
      typeof record.corner === 'string' && CORNERS.has(record.corner)
        ? (record.corner as PillCorner)
        : DEFAULT_CORNER,
    collapsed: record.collapsed === true,
  };
}
