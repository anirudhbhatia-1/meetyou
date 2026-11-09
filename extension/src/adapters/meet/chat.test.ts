import { describe, expect, it } from 'vitest';

import { postChatMessage } from './chat.ts';

/** A tiny stand-in for Meet's chat DOM: a toggle button, a message box and Send. */
function fakeMeet(options: { panelOpen: boolean; sendWorks: boolean; hasChat?: boolean }) {
  const events: string[] = [];
  const attrs = (map: Record<string, string>) => ({
    getAttribute: (name: string) => map[name] ?? null,
    hasAttribute: (name: string) => name in map,
  });
  const box = {
    ...attrs({}),
    value: '',
    textContent: '',
    focus: () => events.push('focus'),
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
  };
  let open = options.panelOpen;
  const send = {
    ...attrs({}),
    click: () => {
      events.push('send');
      if (options.sendWorks) box.value = '';
    },
  };
  const toggle = {
    ...attrs({}),
    click: () => {
      events.push('open');
      open = true;
    },
  };
  const doc = {
    querySelector: (selector: string) => {
      if (options.hasChat === false) return null;
      if (selector.startsWith('textarea[aria-label*="Send a message"')) return open ? box : null;
      if (selector.startsWith('button[aria-label*="Send a message"')) return open ? send : null;
      if (selector.startsWith('button[aria-label*="Chat with everyone"')) return toggle;
      return null;
    },
  } as unknown as ParentNode;
  return { doc, box, events };
}

const instant = () => Promise.resolve();

describe('postChatMessage (S4-07)', () => {
  it('opens the chat panel, types and sends', async () => {
    const meet = fakeMeet({ panelOpen: false, sendWorks: true });
    expect(await postChatMessage(meet.doc, 'Hi all', instant)).toBe(true);
    expect(meet.events).toEqual(['open', 'focus', 'input', 'send']);
  });

  it('reports a failure when Meet keeps the text or has no chat', async () => {
    const stuck = fakeMeet({ panelOpen: true, sendWorks: false });
    expect(await postChatMessage(stuck.doc, 'Hi all', instant)).toBe(false);
    expect(stuck.box.value).toBe('Hi all');
    const none = fakeMeet({ panelOpen: false, sendWorks: true, hasChat: false });
    expect(await postChatMessage(none.doc, 'Hi all', instant)).toBe(false);
  });
});
