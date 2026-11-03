import { isMeetUrl } from './meet-tab.ts';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/index.html';
let creatingOffscreenDocument: Promise<void> | undefined;

async function configureSidePanel(tabId: number, url: string | undefined): Promise<void> {
  if (!isMeetUrl(url)) {
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
    return;
  }

  await chrome.sidePanel.setOptions({
    tabId,
    enabled: true,
    path: 'sidepanel/index.html',
  });
}

async function configureExistingTabs(): Promise<void> {
  await chrome.sidePanel.setOptions({ enabled: false });

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.flatMap((tab) => (tab.id === undefined ? [] : [configureSidePanel(tab.id, tab.url)])),
  );
}

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creatingOffscreenDocument !== undefined) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'Capture Google Meet media after an explicit recording action.',
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = undefined;
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void configureExistingTabs();

  if (details.reason === 'install') {
    void chrome.tabs.create({ url: 'onboarding/index.html' });
  }
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void configureExistingTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void configureSidePanel(tabId, changeInfo.url ?? tab.url);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void chrome.tabs
    .get(activeInfo.tabId)
    .then((tab) => configureSidePanel(activeInfo.tabId, tab.url));
});

chrome.runtime.onMessage.addListener((message) => {
  if (message !== 'offscreen.ensure') {
    return;
  }

  void ensureOffscreenDocument();
});

void configureExistingTabs();
