import { lightColors as c, fonts, motion } from '@meetyou/design-tokens';

import { formatClock } from '../format.ts';
import {
  cornerPosition,
  DRAG_THRESHOLD_PX,
  nearestCorner,
  parsePillLayout,
  pillViewFor,
  type PillLayout,
  type PillView,
} from './pill-model.ts';

export interface RecordingPillCallbacks {
  /** Click on the pill: open or focus the side panel (§8.4). */
  onOpenPanel: () => void;
  loadLayout: () => Promise<unknown>;
  saveLayout: (layout: PillLayout) => void;
}

export interface RecordingSnapshot {
  status: string;
  startedAt: number | null;
  video: string;
}

const HOST_ID = 'meetyou-pill-root';

const VIDEO_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><path d="M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>';
const COLLAPSE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';

/**
 * Recording pill over Google Meet (DESIGN §8.4, S4-04): glass pill with a status dot, label,
 * timer and video icon; draggable to any corner, collapsible to the dot, click opens the side
 * panel. Closed Shadow DOM like the prompt chip, so Meet's CSS cannot reach it and page scripts
 * cannot click it. Never restyles Meet's own tiles.
 * [Verify] in Chrome across Meet layouts (grid, spotlight, side panels open) — S4-04 acceptance.
 */
export class RecordingPill {
  private readonly doc: Document;
  private readonly callbacks: RecordingPillCallbacks;
  private host: HTMLElement | null = null;
  private pill: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private timer: HTMLElement | null = null;
  private videoIcon: HTMLElement | null = null;
  private expandButton: HTMLButtonElement | null = null;
  private live: HTMLElement | null = null;
  private layout: PillLayout = parsePillLayout(null);
  private view: PillView | null = null;
  private startedAt: number | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  /** A drag ends with a click on the pressed button; that click must not open the panel. */
  private suppressClick = false;

  constructor(doc: Document, callbacks: RecordingPillCallbacks) {
    this.doc = doc;
    this.callbacks = callbacks;
    callbacks
      .loadLayout()
      .then((value) => {
        this.layout = parsePillLayout(value);
        this.applyLayout();
      })
      .catch(() => undefined);
  }

  /** Shows, updates or hides the pill for the recorded tab's state. */
  public update(snapshot: RecordingSnapshot): void {
    const view = pillViewFor(snapshot.status, snapshot.video);
    this.startedAt = snapshot.startedAt;
    if (view === null) {
      this.hide();
      return;
    }
    if (this.host === null) this.mount();
    const announce = this.view === null || this.view.label !== view.label;
    this.view = view;
    this.render(announce);
    if (this.host !== null) this.host.style.display = 'block';
    this.setTicking(view.showTimer && this.startedAt !== null);
  }

  public hide(): void {
    this.view = null;
    this.setTicking(false);
    if (this.host !== null) this.host.style.display = 'none';
  }

  public unmount(): void {
    this.setTicking(false);
    this.host?.remove();
    this.host = null;
    this.pill = null;
    this.view = null;
  }

  public isShowing(): boolean {
    return this.view !== null;
  }

  private setTicking(on: boolean): void {
    if (on && this.tick === null) {
      this.tick = setInterval(() => this.renderTimer(), 1000);
    } else if (!on && this.tick !== null) {
      clearInterval(this.tick);
      this.tick = null;
    }
    this.renderTimer();
  }

  private renderTimer(): void {
    if (this.timer === null) return;
    const show = this.view?.showTimer === true && this.startedAt !== null;
    this.timer.hidden = !show;
    if (show && this.startedAt !== null) {
      this.timer.textContent = formatClock(Date.now() - this.startedAt);
    }
  }

  private render(announce: boolean): void {
    const view = this.view;
    if (view === null || this.pill === null) return;
    this.pill.dataset.tone = view.tone;
    this.pill.dataset.collapsed = String(this.layout.collapsed);
    if (this.label !== null) this.label.textContent = view.label;
    if (this.videoIcon !== null) this.videoIcon.hidden = !view.showVideo;
    if (this.expandButton !== null) {
      this.expandButton.setAttribute('aria-label', `Show recording pill — ${view.label}`);
    }
    // Announced once per state change, never per timer tick.
    if (announce && this.live !== null) this.live.textContent = view.label;
    this.renderTimer();
  }

  private applyLayout(): void {
    if (this.host !== null) Object.assign(this.host.style, cornerPosition(this.layout.corner));
    this.render(false);
  }

  private setLayout(layout: PillLayout): void {
    this.layout = layout;
    this.applyLayout();
    this.callbacks.saveLayout(layout);
  }

  private mount(): void {
    // A pill left by a content script whose extension was reloaded is dead: replace it.
    this.doc.getElementById(HOST_ID)?.remove();
    const host = this.doc.createElement('div');
    host.id = HOST_ID;
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.display = 'none';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = this.doc.createElement('style');
    style.textContent = PILL_CSS;
    const pill = this.doc.createElement('div');
    pill.className = 'pill';
    pill.setAttribute('role', 'group');
    pill.setAttribute('aria-label', 'Minutes recording');
    pill.innerHTML = `
      <button type="button" class="expand"><span class="dot"></span></button>
      <button type="button" class="main" aria-label="Open Minutes side panel">
        <span class="dot"></span>
        <span class="label"></span>
        <span class="timer"></span>
        <span class="video" role="img" aria-label="Recording audio and screen">${VIDEO_ICON}</span>
      </button>
      <button type="button" class="collapse" aria-label="Collapse to a dot">${COLLAPSE_ICON}</button>
    `;
    const live = this.doc.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');

    this.pill = pill;
    this.label = pill.querySelector('.label');
    this.timer = pill.querySelector('.timer');
    this.videoIcon = pill.querySelector('.video');
    this.expandButton = pill.querySelector('.expand');
    this.live = live;

    pill.querySelector('.main')?.addEventListener('click', (e) => {
      if (!this.acceptClick(e)) return;
      this.callbacks.onOpenPanel();
    });
    pill.querySelector('.collapse')?.addEventListener('click', (e) => {
      if (!this.acceptClick(e)) return;
      this.setLayout({ ...this.layout, collapsed: true });
      this.expandButton?.focus();
    });
    this.expandButton?.addEventListener('click', (e) => {
      if (!this.acceptClick(e)) return;
      this.setLayout({ ...this.layout, collapsed: false });
    });
    this.attachDrag(pill);

    shadow.append(style, pill, live);
    this.host = host;
    this.doc.body.appendChild(host);
    this.applyLayout();
  }

  /** Page scripts' synthetic clicks (`isTrusted === false`) and drag ends do nothing. */
  private acceptClick(e: Event): boolean {
    e.stopPropagation();
    if (this.suppressClick) return false;
    return e.isTrusted;
  }

  /**
   * Drag anywhere on the pill; on release it snaps to the nearest corner (§8.4). Move and release
   * are followed on the window, so a fast drag that leaves the pill still ends; pointer capture is
   * not used because it would retarget the release and break the buttons' clicks.
   */
  private attachDrag(pill: HTMLElement): void {
    const view = this.doc.defaultView;
    if (view === null) return;
    const move = (e: PointerEvent): void => {
      const drag = this.drag;
      const host = this.host;
      if (drag === null || host === null || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        pill.classList.add('dragging');
      }
      const rect = host.getBoundingClientRect();
      Object.assign(host.style, {
        top: `${rect.top + e.clientY - drag.y}px`,
        left: `${rect.left + e.clientX - drag.x}px`,
        bottom: '',
        right: '',
      });
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const end = (e: PointerEvent): void => {
      const drag = this.drag;
      if (drag === null || e.pointerId !== drag.id) return;
      this.drag = null;
      view.removeEventListener('pointermove', move, true);
      view.removeEventListener('pointerup', end, true);
      view.removeEventListener('pointercancel', end, true);
      if (!drag.moved || this.host === null) return;
      pill.classList.remove('dragging');
      // The click that follows this release (if it lands on a pill button) is not a click.
      this.suppressClick = true;
      setTimeout(() => {
        this.suppressClick = false;
      }, 0);
      const rect = this.host.getBoundingClientRect();
      this.setLayout({
        ...this.layout,
        corner: nearestCorner(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          view.innerWidth,
          view.innerHeight,
        ),
      });
    };
    pill.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isTrusted || this.drag !== null) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      view.addEventListener('pointermove', move, true);
      view.addEventListener('pointerup', end, true);
      view.addEventListener('pointercancel', end, true);
    });
  }
}

/** DESIGN §5.6 glass over Meet's dark UI, §5.7 pulse, §8.4 layout; colours from design tokens. */
const PILL_CSS = `
  :host { all: initial; }
  .pill {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: 999px;
    background: rgba(251, 250, 246, 0.62);
    backdrop-filter: blur(22px) saturate(1.7);
    -webkit-backdrop-filter: blur(22px) saturate(1.7);
    border: 1px solid rgba(255, 255, 255, 0.75);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.7);
    font: 500 13px/1 ${fonts.sans};
    color: ${c.ink};
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  .pill.dragging { cursor: grabbing; }
  button {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 999px;
    cursor: inherit;
  }
  button:focus-visible { outline: 2px solid ${c.oliveLine}; outline-offset: 2px; }
  .main { padding: 6px 10px 6px 10px; min-height: 28px; }
  .main:hover, .collapse:hover, .expand:hover { background: rgba(17, 18, 14, 0.06); }
  .collapse, .expand { width: 28px; height: 28px; justify-content: center; color: ${c.muted}; }
  .expand { display: none; }
  .pill[data-collapsed='true'] .main,
  .pill[data-collapsed='true'] .collapse { display: none; }
  .pill[data-collapsed='true'] .expand { display: inline-flex; }
  .dot {
    width: 9px;
    height: 9px;
    flex: none;
    border-radius: 50%;
    background: ${c.ember};
    box-sizing: border-box;
  }
  .pill[data-tone='live'] .dot {
    border: 1px solid ${c.emberLine};
    animation: pulse ${motion.recordingPulse}ms infinite;
  }
  .pill[data-tone='paused'] .dot { background: ${c.surface}; border: 1px solid ${c.controlLine}; }
  .pill[data-tone='warn'] .dot { background: ${c.amberDot}; }
  .pill[data-tone='error'] .dot { background: ${c.danger}; }
  .pill[data-tone='error'] .label { color: ${c.danger}; }
  .timer { color: ${c.ink3}; font-variant-numeric: tabular-nums; }
  .video { display: inline-flex; color: ${c.ink3}; }
  [hidden] { display: none !important; }
  @keyframes pulse { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none !important; }
  }
  @media (prefers-reduced-transparency: reduce) {
    .pill {
      background: ${c.surface};
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      border-color: ${c.stroke};
    }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
`;
