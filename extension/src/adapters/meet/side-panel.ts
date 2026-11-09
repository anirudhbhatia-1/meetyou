import {
  CHAT_SELECTORS,
  PARTICIPANT_SELECTORS,
  queryWithFallbacks,
  type SelectorDescriptor,
} from './selectors.ts';

/** How far from the right edge an ancestor may end and still count as the docked panel. */
const EDGE_SLACK_PX = 32;

/** Content that only exists inside Meet's right-hand panel when it is open. */
const PANEL_CONTENT: readonly SelectorDescriptor[] = [
  CHAT_SELECTORS.input,
  PARTICIPANT_SELECTORS.peoplePanelList,
];

/**
 * Width Meet's right-hand panel (People, Chat…) takes from the right edge of the window, or 0
 * when it is closed (DESIGN §8.2: the prompt shifts left of it). There is no selector for the
 * panel itself, so it is found from content we already match inside it: the widest ancestor that
 * ends at the right edge and stays narrower than half the window.
 * [Verify] on real Meet with People and Chat open (S4-04).
 */
export function rightPanelInset(doc: Document): number {
  const width = doc.defaultView?.innerWidth ?? 0;
  if (width === 0) return 0;
  for (const descriptor of PANEL_CONTENT) {
    let element = queryWithFallbacks(doc, descriptor).element;
    let panelLeft: number | null = null;
    while (element !== null && element !== doc.body) {
      const rect = element.getBoundingClientRect();
      if (rect.width >= width / 2) break;
      if (rect.width > 0 && width - rect.right <= EDGE_SLACK_PX) panelLeft = rect.left;
      element = element.parentElement;
    }
    if (panelLeft !== null) return Math.max(0, Math.round(width - panelLeft));
  }
  return 0;
}
