import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PromptChip } from './prompt-chip.ts';

class MockElement {
  public id = '';
  public style: Record<string, string> = {};
  public className = '';
  public textContent = '';
  public attributes: Record<string, string> = {};
  public children: MockElement[] = [];
  public parent: MockElement | null = null;
  public shadow: MockShadowRoot | null = null;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};

  private _innerHTML = '';
  public get innerHTML(): string {
    return this._innerHTML;
  }
  public set innerHTML(html: string) {
    this._innerHTML = html;
    // Simple parser for buttons in the template
    if (html.includes('id="not-now-btn"')) {
      const btn = new MockElement();
      btn.id = 'not-now-btn';
      this.children.push(btn);
    }
    if (html.includes('id="start-btn"')) {
      const btn = new MockElement();
      btn.id = 'start-btn';
      this.children.push(btn);
    }
  }

  public attachShadow(): MockShadowRoot {
    this.shadow = new MockShadowRoot();
    return this.shadow;
  }

  public appendChild(child: MockElement): MockElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  public contains(child: MockElement): boolean {
    if (this === child) return true;
    for (const c of this.children) {
      if (c === child || c.contains(child)) return true;
    }
    return false;
  }

  public remove(): void {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx !== -1) {
        this.parent.children.splice(idx, 1);
      }
      this.parent = null;
    }
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  public querySelector(selector: string): MockElement | null {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return this.findChildById(id);
    }
    return null;
  }

  public addEventListener(event: string, fn: (e: unknown) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(fn);
  }

  public trigger(event: string, eventObj: unknown = {}): void {
    const fns = this.listeners[event] || [];
    for (const fn of fns) {
      fn(eventObj);
    }
  }

  private findChildById(id: string): MockElement | null {
    for (const child of this.children) {
      if (child.id === id) return child;
      const found = child.findChildById(id);
      if (found) return found;
    }
    return null;
  }
}

class MockShadowRoot {
  public children: MockElement[] = [];

  public appendChild(child: MockElement): MockElement {
    this.children.push(child);
    return child;
  }

  public querySelector(selector: string): MockElement | null {
    for (const child of this.children) {
      if (child.id === selector.replace('#', '')) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

class MockDocument {
  public body = new MockElement();
  private docListeners: Record<string, ((e: unknown) => void)[]> = {};

  public createElement(): MockElement {
    return new MockElement();
  }

  public getElementById(id: string): MockElement | null {
    return this.body.querySelector(`#${id}`);
  }

  public addEventListener(event: string, fn: (e: unknown) => void): void {
    if (!this.docListeners[event]) {
      this.docListeners[event] = [];
    }
    this.docListeners[event].push(fn);
  }

  public removeEventListener(event: string, fn: (e: unknown) => void): void {
    if (this.docListeners[event]) {
      this.docListeners[event] = this.docListeners[event].filter((f) => f !== fn);
    }
  }

  public trigger(event: string, eventObj: unknown = {}): void {
    const fns = this.docListeners[event] || [];
    for (const fn of fns) {
      fn(eventObj);
    }
  }
}

describe('PromptChip', () => {
  let doc: MockDocument;
  let onStart: () => void;
  let onDismiss: () => void;
  let chip: PromptChip;

  beforeEach(() => {
    doc = new MockDocument();
    onStart = vi.fn();
    onDismiss = vi.fn();
    chip = new PromptChip(doc as unknown as Document, { onStart, onDismiss });
  });

  it('mounts into DOM with an isolated shadow root and starts hidden', () => {
    chip.mount();
    expect(chip.isMounted()).toBe(true);
    expect(chip.isShowing()).toBe(false);

    const root = doc.getElementById('meetyou-prompt-root');
    expect(root).not.toBeNull();
    expect(root?.style.position).toBe('fixed');
    expect(root?.style.display).toBe('none');
    expect(root?.shadow).not.toBeNull();
  });

  it('shows when in_call is detected and hides on other states', () => {
    chip.updateCallState('in_call');
    expect(chip.isShowing()).toBe(true);

    const root = doc.getElementById('meetyou-prompt-root');
    expect(root?.style.display).toBe('block');

    chip.updateCallState('ended');
    expect(chip.isShowing()).toBe(false);
    expect(root?.style.display).toBe('none');

    chip.updateCallState('in_call');
    expect(chip.isShowing()).toBe(true);
  });

  it('dismisses when Not now is clicked and never shows again during call', () => {
    chip.show();
    expect(chip.isShowing()).toBe(true);

    const root = doc.getElementById('meetyou-prompt-root');
    const notNowBtn = root?.shadow?.querySelector('#not-now-btn');
    expect(notNowBtn).not.toBeNull();

    notNowBtn?.trigger('click', { stopPropagation: vi.fn() });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(chip.isDismissed()).toBe(true);
    expect(chip.isShowing()).toBe(false);

    // Call state transitions should not show it again
    chip.updateCallState('in_call');
    expect(chip.isShowing()).toBe(false);
  });

  it('triggers onStart and hides when Start button is clicked', () => {
    chip.show();
    const root = doc.getElementById('meetyou-prompt-root');
    const startBtn = root?.shadow?.querySelector('#start-btn');
    expect(startBtn).not.toBeNull();

    startBtn?.trigger('click', { stopPropagation: vi.fn() });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(chip.isShowing()).toBe(false);
  });

  it('dismisses when Escape key is pressed while showing', () => {
    chip.show();
    expect(chip.isShowing()).toBe(true);

    doc.trigger('keydown', { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(chip.isDismissed()).toBe(true);
    expect(chip.isShowing()).toBe(false);
  });

  it('auto-hides when recording starts', () => {
    chip.show();
    expect(chip.isShowing()).toBe(true);

    chip.updateRecordingStatus('recording');
    expect(chip.isShowing()).toBe(false);
  });

  it('unmounts cleanly from DOM', () => {
    chip.mount();
    expect(chip.isMounted()).toBe(true);

    chip.unmount();
    expect(chip.isMounted()).toBe(false);
    expect(doc.getElementById('meetyou-prompt-root')).toBeNull();
  });
});
