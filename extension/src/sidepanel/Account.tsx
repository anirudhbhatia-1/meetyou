import { Banner, Button } from '@meetyou/ui';
import { useEffect, useState } from 'react';

import { ACCOUNT_KEY, parseAccount, type Account } from '../background/auth.ts';
import { API_URL } from '../build-config.ts';

/** Signed-in account in cloud mode: undefined while reading, null when signed out. */
export function useAccount(): Account | null | undefined {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  useEffect(() => {
    if (API_URL === '') return;
    let current = true;
    chrome.storage.local
      .get(ACCOUNT_KEY)
      .then((items) => current && setAccount(parseAccount(items)))
      .catch((error: unknown) => console.error('sidepanel: read account failed', error));
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      const change = changes[ACCOUNT_KEY];
      if (areaName === 'local' && change !== undefined) {
        setAccount(parseAccount({ [ACCOUNT_KEY]: change.newValue }));
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      current = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  return API_URL === '' ? null : account;
}

async function ask(type: 'auth.sign_in' | 'auth.sign_out'): Promise<boolean> {
  const reply = await chrome.runtime.sendMessage({ target: 'background', type });
  return typeof reply === 'object' && reply !== null && (reply as { ok?: unknown }).ok === true;
}

/** "Continue with Google" (DESIGN §7.1 copy); the click is the gesture Chrome's sign-in needs. */
export function SignInCard({ title }: { title: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="sign-in">
      <p className="state-text">{title}</p>
      {failed && <Banner tone="error">Sign-in didn&rsquo;t finish. Try again.</Banner>}
      <Button
        variant="primary"
        size="lg"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          ask('auth.sign_in')
            .then((ok) => setFailed(!ok))
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
      >
        Continue with Google
      </Button>
      <span className="option-help">Only your name and email.</span>
    </div>
  );
}

export function AccountLine({ account }: { account: Account }) {
  return (
    <p className="option-help account-line">
      Signed in as {account.email}
      {' · '}
      <button type="button" className="link-btn" onClick={() => void ask('auth.sign_out')}>
        Sign out
      </button>
    </p>
  );
}
