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

export class PromptChip {
  private readonly doc: Document;
  private readonly callbacks: PromptChipCallbacks;
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private dismissed = false;
  private isVisible = false;
  private readonly boundOnKeyDown: (e: KeyboardEvent) => void;

  constructor(doc: Document = document, callbacks: PromptChipCallbacks) {
    this.doc = doc;
    this.callbacks = callbacks;
    this.boundOnKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.dismiss();
      }
    };
  }

  /**
   * Mounts the host container and creates the isolated Shadow DOM tree.
   */
  public mount(): void {
    if (this.host !== null || this.doc.getElementById('meetyou-prompt-root') !== null) {
      return;
    }

    const host = this.doc.createElement('div');
    host.id = 'meetyou-prompt-root';
    host.style.position = 'fixed';
    host.style.top = '18px';
    host.style.right = '18px';
    host.style.zIndex = '2147483647';
    host.style.display = 'none';

    const shadow = host.attachShadow({ mode: 'open' });
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
    if (this.dismissed) {
      return;
    }
    if (this.host === null) {
      this.mount();
    }
    if (this.host !== null) {
      this.host.style.display = 'block';
      this.isVisible = true;
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
      this.isVisible = false;
    }
  }

  /**
   * Reacts to Meet call state changes.
   */
  public updateCallState(state: string): void {
    if (state === 'in_call') {
      this.show();
    } else {
      this.hide();
    }
  }

  /**
   * Reacts to extension recording status updates.
   */
  public updateRecordingStatus(status: string): void {
    if (status === 'starting' || status === 'recording') {
      this.hide();
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
    `;

    const container = this.doc.createElement('div');
    container.className = 'prompt-card';
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-live', 'polite');
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

    const notNowBtn = container.querySelector('#not-now-btn');
    notNowBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismiss();
    });

    const startBtn = container.querySelector('#start-btn');
    startBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      this.callbacks.onStart();
    });

    this.shadow.appendChild(style);
    this.shadow.appendChild(container);
  }
}
