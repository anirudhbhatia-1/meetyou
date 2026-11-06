// Chrome APIs used by capture (S1-02 onward). Kept apart from chrome.d.ts so the declarations merge
// without touching the shared file. Shapes verified against developer.chrome.com/docs/extensions
// (tabCapture, action, sidePanel, offscreen, storage, commands, tabs) on 2026-11-03.
declare namespace chrome {
  namespace tabCapture {
    function getMediaStreamId(options?: {
      targetTabId?: number;
      consumerTabId?: number;
    }): Promise<string>;
  }
  namespace action {
    const onClicked: { addListener(callback: (tab: tabs.Tab) => void): void };
    function setBadgeText(details: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  }
  namespace sidePanel {
    function open(options: { tabId: number }): Promise<void>;
  }
  namespace offscreen {
    function closeDocument(): Promise<void>;
  }
  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const session: StorageArea;
    const local: StorageArea;
    type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void;
    const onChanged: {
      addListener(callback: ChangeListener): void;
      removeListener(callback: ChangeListener): void;
    };
  }
  namespace commands {
    const onCommand: {
      addListener(callback: (command: string, tab?: tabs.Tab) => void): void;
    };
  }
  namespace tabs {
    const onRemoved: { addListener(callback: (tabId: number) => void): void };
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
    function query(queryInfo: {
      active: boolean;
      lastFocusedWindow: boolean;
    }): Promise<readonly Tab[]>;
  }
}
