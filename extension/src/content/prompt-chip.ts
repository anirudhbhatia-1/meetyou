/**
 * Prompt chip prototype in Shadow DOM (Task S1-09, DESIGN §8.2, ARCHITECTURE §26.2).
 *
 * Appears when `in_call` is detected on meet.google.com. Encapsulated entirely in Shadow DOM
 * so Google Meet styles cannot leak in or break its appearance. Tests user gesture entry points
 * for sidePanel.open() and tabCapture.
 */

export interface PromptChipCallbacks {
  onStart: () => void;
  onDismiss: () => void;
}

/** Recording statuses during which the chip must stay hidden (capture-state.ts CAPTURING). */
const ACTIVE_STATUSES = new Set(['starting', 'recording', 'paused', 'reconnecting', 'stopping']);

/** Problems reported back by the service worker after a chip action. */
export type PromptProblem = 'start_failed' | 'panel_failed';

const PROBLEM_TEXT: Record<PromptProblem, string> = {
  start_failed: 'Recording did not start. Click the MeetYou icon in the toolbar to start.',
  panel_failed: 'Recording started. Open MeetYou from the toolbar to see notes.',
};

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
  private problemEl: HTMLElement | null = null;
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

    // Closed, so page scripts cannot reach the Start button through `host.shadowRoot`.
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
      this.problemEl = null;
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

  /** Shows the chip again with a short explanation after a chip action failed. */
  public showProblem(problem: PromptProblem): void {
    if (this.host === null) this.mount();
    if (this.problemEl !== null) this.problemEl.textContent = PROBLEM_TEXT[problem];
    if (problem === 'start_failed') this.recordingActive = false;
    if (this.host !== null) {
      this.host.style.display = 'block';
      this.isVisible = true;
      if (this.liveRegion !== null) this.liveRegion.textContent = PROBLEM_TEXT[problem];
    }
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

    const style = this.doc.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .prompt-card {
        box-sizing: border-box;
        width: min(320px, calc(100vw - 36px));
        background: rgba(251, 250, 246, 0.94);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(17, 18, 14, 0.12);
        border-radius: 18px;
        padding: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
        color: #11120e;
        display: flex;
        flex-direction: column;
        gap: 10px;
        animation: prompt-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes prompt-fade-in {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .prompt-header {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .prompt-logo {
        width: 22px;
        height: 22px;
        border-radius: 6px;
        background: #11120e;
        color: #f6f5ef;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
        flex-shrink: 0;
      }
      .prompt-title {
        font-size: 14px;
        font-weight: 600;
        color: #11120e;
        margin: 0;
        line-height: 1.25;
      }
      .prompt-body {
        font-size: 12px;
        line-height: 1.45;
        color: #3a3b35;
        margin: 0;
      }
      .prompt-reminder {
        font-size: 11px;
        color: #74756d;
        margin: 0;
      }
      .prompt-actions {
        display: flex;
        gap: 8px;
        margin-top: 4px;
      }
      .btn {
        box-sizing: border-box;
        border: none;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        padding: 8px 14px;
        border-radius: 999px;
        transition: background 0.15s ease, transform 0.05s ease;
        text-align: center;
      }
      .btn:active {
        transform: scale(0.98);
      }
      .btn-secondary {
        background: rgba(17, 18, 14, 0.07);
        color: #2a2b26;
        flex: 1;
      }
      .btn-secondary:hover {
        background: rgba(17, 18, 14, 0.12);
      }
      .btn-primary {
        background: #11120e;
        color: #ffffff;
        flex: 1.2;
      }
      .btn-primary:hover {
        background: #2a2b26;
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

    const container = this.doc.createElement('div');
    container.className = 'prompt-card';
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-labelledby', 'prompt-heading');

    container.innerHTML = `
      <div class="prompt-header">
        <div class="prompt-logo">M</div>
        <h3 id="prompt-heading" class="prompt-title">Take notes for this call?</h3>
      </div>
      <p class="prompt-body">Nothing joins the call. Recording starts only when you press Start.</p>
      <p class="prompt-reminder">Audio and the Meet tab's video will be recorded.</p>
      <div class="prompt-actions">
        <button type="button" class="btn btn-secondary" id="not-now-btn">Not now</button>
        <button type="button" class="btn btn-primary" id="start-btn">Start</button>
      </div>
    `;

    // Synthetic clicks from page scripts (`isTrusted === false`) must not start a recording.
    const notNowBtn = container.querySelector('#not-now-btn');
    notNowBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.isTrusted === false) return;
      this.dismiss();
    });

    const startBtn = container.querySelector('#start-btn');
    startBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.isTrusted === false) return;
      if (this.problemEl !== null) this.problemEl.textContent = '';
      this.hide();
      this.callbacks.onStart();
    });

    const problem = this.doc.createElement('p');
    problem.className = 'prompt-reminder';
    problem.setAttribute('role', 'status');
    container.appendChild(problem);
    this.problemEl = problem;

    const live = this.doc.createElement('div');
    live.setAttribute('aria-live', 'polite');
    live.className = 'sr-only';
    this.liveRegion = live;

    this.shadow.appendChild(style);
    this.shadow.appendChild(container);
    this.shadow.appendChild(live);
  }
}
