import { lightColors as c, fonts, radius } from '@meetyou/design-tokens';

/**
 * Meet prompt in Shadow DOM (S1-09 prototype, restyled to DESIGN §8.2 in S4-04).
 *
 * Appears when `in_call` is detected on meet.google.com. Encapsulated entirely in Shadow DOM
 * so Google Meet styles cannot leak in or break its appearance. It has no Start button: Chrome
 * allows tab capture only after the toolbar icon or the keyboard shortcut (a click in the page
 * does not invoke the extension, verified 2026-11-06; ARCHITECTURE §26.2 Q1), so it says how to
 * start instead of offering a button that is refused.
 * TODO(S4-04): shift left of Meet's right-hand panel when it is open (§8.2) — needs a selector
 * for that panel in adapters/meet/selectors.ts, verified on real Meet.
 */

export interface PromptChipCallbacks {
  onDismiss: () => void;
}

/** Recording statuses during which the chip must stay hidden (capture-state.ts CAPTURING). */
const ACTIVE_STATUSES = new Set(['starting', 'recording', 'paused', 'reconnecting', 'stopping']);

/** Pre-recording reminder (§8.2, FR-CAP-14): says whether the screen is recorded too. */
export function reminderText(recordVideo: boolean): string {
  return recordVideo
    ? "Audio and the Meet tab's video will be recorded."
    : 'Audio will be recorded.';
}

/** The manifest's `toggle-recording` shortcut (MacCtrl is the Control key on a Mac). */
export function startShortcut(userAgent: string): string {
  return /Mac/i.test(userAgent) ? 'Ctrl+Shift+R' : 'Alt+Shift+R';
}

/** §8.2 body: the two ways Chrome accepts to start recording a tab. */
export function startHint(userAgent: string): { before: string; shortcut: string; after: string } {
  return {
    before: 'Nothing joins the call. To start, press ',
    shortcut: startShortcut(userAgent),
    after: ' or click the MeetYou (M) icon in Chrome’s toolbar, then Start.',
  };
}

export class PromptChip {
  private readonly doc: Document;
  private readonly callbacks: PromptChipCallbacks;
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private dismissed = false;
  private isVisible = false;
  private recordingActive = false;
  private meetingCode: string | null = null;
  private liveRegion: HTMLElement | null = null;
  private reminderEl: HTMLElement | null = null;
  // TODO(S4-12): also off when retention is "Delete after notes" (ADR-0011 §3.5).
  private recordVideo = true;
  private readonly boundOnKeyDown: (e: KeyboardEvent) => void;

  constructor(doc: Document = document, callbacks: PromptChipCallbacks) {
    this.doc = doc;
    this.callbacks = callbacks;
    // Only an Escape pressed inside the chip dismisses it; Meet uses Escape for its own panels.
    this.boundOnKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !this.isVisible || this.host === null) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.includes(this.host)) this.dismiss();
    };
  }

  /**
   * Mounts the host container and creates the isolated Shadow DOM tree.
   */
  public mount(): void {
    if (this.host !== null) return;
    // A chip left by a content script whose extension was reloaded has dead buttons: replace it.
    this.doc.getElementById('meetyou-prompt-root')?.remove();

    const host = this.doc.createElement('div');
    host.id = 'meetyou-prompt-root';
    host.style.position = 'fixed';
    host.style.top = '18px';
    host.style.right = '18px';
    host.style.zIndex = '2147483647';
    host.style.display = 'none';

    // Closed, so page scripts cannot reach the chip's buttons through `host.shadowRoot`.
    const shadow = host.attachShadow({ mode: 'closed' });
    this.shadow = shadow;
    this.host = host;

    this.render();
    this.doc.body.appendChild(host);
    this.doc.addEventListener('keydown', this.boundOnKeyDown);
  }

  /**
   * Shows the prompt chip unless previously dismissed during this session.
   */
  public show(): void {
    if (this.dismissed || this.recordingActive) {
      return;
    }
    if (this.host === null) {
      this.mount();
    }
    if (this.host !== null) {
      this.host.style.display = 'block';
      this.isVisible = true;
      // Changing the live region's text (not toggling display) is what screen readers announce.
      if (this.liveRegion !== null) this.liveRegion.textContent = 'Take notes for this call?';
    }
  }

  /**
   * Hides the prompt chip without setting dismissed = true.
   */
  public hide(): void {
    if (this.host !== null) {
      this.host.style.display = 'none';
      this.isVisible = false;
    }
  }

  /**
   * Dismisses the prompt chip for this call session (DESIGN §8.2 "Not now").
   */
  public dismiss(): void {
    this.dismissed = true;
    this.hide();
    this.callbacks.onDismiss();
  }

  /**
   * Unmounts the host and removes event listeners.
   */
  public unmount(): void {
    this.doc.removeEventListener('keydown', this.boundOnKeyDown);
    if (this.host !== null) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
      this.liveRegion = null;
      this.isVisible = false;
    }
  }

  /**
   * Reacts to Meet call state changes.
   */
  public updateCallState(state: string, meetingCode: string | null = null): void {
    // "Not now" applies to one call (DESIGN §8.2); Meet can move to another call without a reload.
    if (meetingCode !== null && meetingCode !== this.meetingCode) {
      this.meetingCode = meetingCode;
      this.dismissed = false;
    }
    if (state === 'in_call') {
      this.show();
    } else {
      this.hide();
    }
  }

  /**
   * Reacts to extension recording status updates: never shown over a recording in progress.
   */
  public updateRecordingStatus(status: string): void {
    this.recordingActive = ACTIVE_STATUSES.has(status);
    if (this.recordingActive) this.hide();
  }

  /** The "Record video" setting, so the reminder says what will be recorded. */
  public setRecordVideo(recordVideo: boolean): void {
    this.recordVideo = recordVideo;
    if (this.reminderEl !== null) this.reminderEl.textContent = reminderText(recordVideo);
  }

  public isMounted(): boolean {
    return this.host !== null && this.doc.body.contains(this.host);
  }

  public isShowing(): boolean {
    return this.isVisible;
  }

  public isDismissed(): boolean {
    return this.dismissed;
  }

  private render(): void {
    if (this.shadow === null) return;
    const el = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className: string,
      text = '',
    ): HTMLElementTagNameMap[K] => {
      const node = this.doc.createElement(tag);
      node.className = className;
      node.textContent = text;
      return node;
    };

    const style = this.doc.createElement('style');
    style.textContent = PROMPT_CSS;

    const container = el('div', 'prompt-card');
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-labelledby', 'prompt-heading');

    const header = el('div', 'prompt-header');
    const tile = el('div', 'prompt-tile');
    tile.setAttribute('aria-hidden', 'true');
    tile.appendChild(el('span', 'prompt-tile-dot'));
    const title = el('h3', 'prompt-title', 'Take notes for this call?');
    title.id = 'prompt-heading';
    header.appendChild(tile);
    header.appendChild(title);

    const hint = startHint(this.doc.defaultView?.navigator.userAgent ?? '');
    const body = el('p', 'prompt-body', hint.before);
    body.appendChild(el('kbd', 'prompt-kbd', hint.shortcut));
    body.appendChild(this.doc.createTextNode(hint.after));
    const reminder = el('p', 'prompt-reminder', reminderText(this.recordVideo));
    this.reminderEl = reminder;

    const actions = el('div', 'prompt-actions');
    const notNowBtn = el('button', 'btn btn-secondary', 'Not now');
    notNowBtn.type = 'button';
    notNowBtn.id = 'not-now-btn';
    actions.appendChild(notNowBtn);

    // Synthetic clicks from page scripts (`isTrusted === false`) are ignored.
    notNowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.isTrusted === false) return;
      this.dismiss();
    });

    container.appendChild(header);
    container.appendChild(body);
    container.appendChild(reminder);
    container.appendChild(actions);

    const live = el('div', 'sr-only');
    live.setAttribute('aria-live', 'polite');
    this.liveRegion = live;

    this.shadow.appendChild(style);
    this.shadow.appendChild(container);
    this.shadow.appendChild(live);
  }
}

/** DESIGN §8.2 over Meet's dark UI: §5.6 glass, §6.1 buttons; colours from design tokens. */
const PROMPT_CSS = `
  :host { all: initial; }
  .prompt-card {
    box-sizing: border-box;
    width: min(300px, calc(100vw - 36px));
    padding: 16px;
    border-radius: ${radius.prompt}px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    color: ${c.ink};
    font: 400 14px/1.45 ${fonts.sans};
    background: rgba(251, 250, 246, 0.62);
    backdrop-filter: blur(22px) saturate(1.7);
    -webkit-backdrop-filter: blur(22px) saturate(1.7);
    border: 1px solid rgba(255, 255, 255, 0.75);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.7);
  }
  .prompt-header { display: flex; align-items: center; gap: 10px; }
  .prompt-tile {
    width: 26px;
    height: 26px;
    flex: none;
    box-sizing: border-box;
    border-radius: 8px;
    background: ${c.surface};
    border: 1px solid ${c.stroke};
    display: grid;
    place-items: center;
  }
  .prompt-tile-dot { width: 9px; height: 9px; border-radius: 50%; background: ${c.olive}; }
  .prompt-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.3; }
  .prompt-body { margin: 0; font-size: 13px; color: #3a3b35; }
  .prompt-kbd {
    padding: 1px 6px;
    border-radius: 6px;
    border: 1px solid rgba(17, 18, 14, 0.18);
    background: rgba(255, 255, 255, 0.6);
    font: 600 12px ${fonts.sans};
    white-space: nowrap;
  }
  .prompt-reminder { margin: 0; font-size: 12px; color: ${c.muted}; }
  .prompt-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn {
    all: unset;
    box-sizing: border-box;
    min-height: 40px;
    padding: 0 16px;
    border-radius: 999px;
    font: 500 14px ${fonts.sans};
    text-align: center;
    cursor: pointer;
    transition: background 150ms;
  }
  .btn:focus-visible { outline: 2px solid ${c.oliveLine}; outline-offset: 2px; }
  .btn-secondary {
    background: rgba(255, 255, 255, 0.5);
    border: 1px solid rgba(17, 18, 14, 0.15);
    color: ${c.ink};
  }
  .btn-secondary:hover { background: rgba(255, 255, 255, 0.7); }
  @media (prefers-reduced-motion: reduce) {
    .btn { transition: none; }
  }
  @media (prefers-reduced-transparency: reduce) {
    .prompt-card {
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
