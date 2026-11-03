declare namespace chrome {
  namespace runtime {
    const id: string;
    const onInstalled: { addListener(callback: (details: { reason: string }) => void): void };
    const onStartup: { addListener(callback: () => void): void };
    function getURL(path: string): string;
    function getContexts(filter: {
      contextTypes: readonly string[];
      documentUrls: readonly string[];
    }): Promise<readonly unknown[]>;
    function sendMessage(message: unknown): Promise<unknown>;
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
  }
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    interface ActiveInfo {
      tabId: number;
    }
    const onUpdated: {
      addListener(callback: (tabId: number, changeInfo: { url?: string }, tab: Tab) => void): void;
    };
    const onActivated: {
      addListener(callback: (activeInfo: ActiveInfo) => void): void;
    };
    function get(tabId: number): Promise<Tab>;
    function query(queryInfo: { url?: string[] }): Promise<readonly Tab[]>;
    function create(createProperties: { url: string }): Promise<Tab>;
  }
  namespace sidePanel {
    function setOptions(options: {
      tabId?: number;
      path?: string;
      enabled: boolean;
    }): Promise<void>;
    function setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  }
  namespace offscreen {
    function createDocument(options: {
      url: string;
      reasons: readonly string[];
      justification: string;
    }): Promise<void>;
  }
}
