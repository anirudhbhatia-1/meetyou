import { describe, expect, it } from 'vitest';

import { rightPanelInset } from './side-panel.ts';

const WIDTH = 1440;

interface Box {
  left: number;
  width: number;
}

/** A page whose chat box sits inside `chain` (innermost first), each ancestor at its own rect. */
function fakePage(chain: Box[] | null): Document {
  const body = { getBoundingClientRect: () => ({ left: 0, width: WIDTH, right: WIDTH }) };
  let parent: unknown = body;
  const elements = (chain ?? [])
    .slice()
    .reverse()
    .map((box) => {
      const element = {
        parentElement: parent,
        getBoundingClientRect: () => ({ ...box, right: box.left + box.width }),
      };
      parent = element;
      return element;
    });
  const chatBox = elements.at(-1) ?? null;
  return {
    body,
    defaultView: { innerWidth: WIDTH },
    querySelector: (selector: string) =>
      selector.startsWith('textarea[aria-label*="Send a message"') ? chatBox : null,
  } as unknown as Document;
}

describe('rightPanelInset (DESIGN §8.2)', () => {
  it('is 0 when no panel content is on the page', () => {
    expect(rightPanelInset(fakePage(null))).toBe(0);
  });

  it('measures the widest ancestor docked at the right edge', () => {
    const page = fakePage([
      { left: WIDTH - 330, width: 300 },
      { left: WIDTH - 344, width: 328 },
      { left: WIDTH - 360, width: 360 },
      { left: 0, width: WIDTH },
    ]);
    expect(rightPanelInset(page)).toBe(360);
  });

  it('ignores content that is hidden or away from the right edge', () => {
    expect(rightPanelInset(fakePage([{ left: 0, width: 0 }]))).toBe(0);
    expect(rightPanelInset(fakePage([{ left: 100, width: 300 }]))).toBe(0);
  });
});
