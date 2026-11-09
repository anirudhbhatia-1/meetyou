import { CHAT_SELECTORS, queryWithFallbacks } from './selectors.ts';

/** How long Meet may take to open its chat panel or enable Send. */
const WAIT_MS = 3_000;
const POLL_MS = 100;

type Sleep = (ms: number) => Promise<void>;
const sleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(find: () => T | null, ms: number, pause: Sleep): Promise<T | null> {
  for (let waited = 0; ; waited += POLL_MS) {
    const found = find();
    if (found !== null || waited >= ms) return found;
    await pause(POLL_MS);
  }
}

function isDisabled(el: Element): boolean {
  return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
}

/**
 * Types into a field the way a person does, so Meet's own framework sees the change: the native
 * value setter (bypassing any wrapper on the element) and an `input` event.
 */
function setText(el: Element, text: string): void {
  if (el.getAttribute('contenteditable') === 'true') {
    el.textContent = text;
  } else {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el) as object,
      'value',
    )?.set;
    if (setter !== undefined) setter.call(el, text);
    else (el as unknown as { value: string }).value = text;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function currentText(el: Element): string {
  return el.getAttribute('contenteditable') === 'true'
    ? (el.textContent ?? '')
    : ((el as unknown as { value?: string }).value ?? '');
}

/**
 * Posts the consent notice into Meet chat (S4-07, FR-CON-01): opens the chat panel if needed, types
 * the message and sends it. True only when Meet took the message (the box emptied after Send).
 * The text is the user's own message; it is never logged.
 */
export async function postChatMessage(
  doc: ParentNode,
  text: string,
  pause: Sleep = sleep,
): Promise<boolean> {
  const findInput = () => queryWithFallbacks(doc, CHAT_SELECTORS.input).element;
  let input = findInput();
  if (input === null) {
    const open = queryWithFallbacks(doc, CHAT_SELECTORS.openButton).element;
    if (open === null) return false;
    (open as HTMLElement).click();
    input = await waitFor(findInput, WAIT_MS, pause);
    if (input === null) return false;
  }
  (input as HTMLElement).focus?.();
  setText(input, text);
  const send = await waitFor(
    () => {
      const el = queryWithFallbacks(doc, CHAT_SELECTORS.sendButton).element;
      return el !== null && !isDisabled(el) ? el : null;
    },
    WAIT_MS,
    pause,
  );
  if (send === null) return false;
  (send as HTMLElement).click();
  const sent = await waitFor(
    () => (currentText(input).trim() === '' ? true : null),
    WAIT_MS,
    pause,
  );
  return sent === true;
}
