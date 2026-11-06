// Chrome APIs used by sign-in (S2-09, ADR-0004 §4.1). Shapes per developer.chrome.com/docs/
// extensions/reference/api/identity: launchWebAuthFlow returns a promise (Chrome 106+) resolving to
// the final redirect URL; getRedirectURL gives https://<extension-id>.chromiumapp.org/<path>.
declare namespace chrome {
  namespace identity {
    function getRedirectURL(path?: string): string;
    function launchWebAuthFlow(details: {
      url: string;
      interactive?: boolean;
    }): Promise<string | undefined>;
  }
  namespace storage {
    interface StorageArea {
      remove(keys: string | string[]): Promise<void>;
    }
  }
  namespace runtime {
    function getManifest(): { version: string };
  }
}
