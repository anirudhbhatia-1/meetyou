import { useCallback, useEffect, useMemo, useState } from 'react';

import { CALLBACK_PATH, WebAuth } from './api/auth.ts';
import { createHttpApi } from './api/http.ts';
import type { LibraryApi } from './api/types.ts';
import { Banner, Button, SkeletonRows, ToastProvider } from '@meetyou/ui';
import { Analytics, AnalyticsContext } from './lib/analytics.ts';
import { ApiContext } from './lib/api-context.ts';
import { useOnline } from './lib/online.ts';
import { useRoute } from './lib/router.ts';
import { loadRuntimeConfig } from './lib/runtime-config.ts';
import { useAsync } from './lib/useAsync.ts';
import { ActionItems } from './screens/ActionItems.tsx';
import { Catalogue } from './screens/Catalogue.tsx';
import { Home } from './screens/Home.tsx';
import { MeetingDetail } from './screens/MeetingDetail.tsx';
import { Meetings } from './screens/Meetings.tsx';
import { Settings } from './screens/Settings.tsx';
import { Sidebar } from './screens/Sidebar.tsx';
import { SignIn } from './screens/SignIn.tsx';

type Boot =
  | { state: 'loading' }
  /** Production could not read `/config.json`: never fall back to the mock API there. */
  | { state: 'unavailable' }
  | { state: 'signed-out'; clientId: string; failed: boolean }
  | { state: 'ready'; api: LibraryApi };

/**
 * Sign-in gate (ADR-0004 §4.5): with `/config.json` the app talks to the API and needs a session
 * (refresh cookie, or the Google callback); without it, Vite dev runs on the mock API. Production
 * builds leave the mock out (S4-14) and show a reload message instead.
 */
export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const signedOut = useCallback(
    (id: string, failed = false) => setBoot({ state: 'signed-out', clientId: id, failed }),
    [],
  );
  const auth = useMemo(
    () =>
      new WebAuth({
        onSignedOut: () => setBoot((b) => (b.state === 'ready' ? { state: 'loading' } : b)),
      }),
    [],
  );

  useEffect(() => {
    let current = true;
    void (async () => {
      const config = await loadRuntimeConfig();
      if (!current) return;
      if (config === null) {
        if (import.meta.env.DEV) {
          const { createMockApi } = await import('./api/mock.ts');
          if (current) setBoot({ state: 'ready', api: createMockApi() });
        } else {
          setBoot({ state: 'unavailable' });
        }
        return;
      }
      setClientId(config.googleClientId);
      const ready = () => setBoot({ state: 'ready', api: createHttpApi(auth) });
      try {
        if (window.location.pathname === CALLBACK_PATH) {
          const returnTo = await auth.completeSignIn(new URL(window.location.href));
          window.history.replaceState(null, '', `/${returnTo}`);
          if (current) ready();
        } else if (await auth.refresh()) {
          if (current) ready();
        } else if (current) {
          signedOut(config.googleClientId);
        }
      } catch {
        window.history.replaceState(null, '', '/');
        if (current) signedOut(config.googleClientId, true);
      }
    })();
    return () => {
      current = false;
    };
  }, [auth, signedOut]);

  // A failed refresh mid-session lands here (loading after ready): show sign-in again.
  useEffect(() => {
    if (boot.state === 'loading' && clientId !== '') signedOut(clientId);
  }, [boot.state, clientId, signedOut]);

  if (boot.state === 'loading') {
    return (
      <main className="signin">
        <SkeletonRows rows={3} />
      </main>
    );
  }
  if (boot.state === 'unavailable') {
    return (
      <main className="signin">
        <Banner tone="error">
          Couldn&rsquo;t reach Minutes. Check your connection and reload.
        </Banner>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </main>
    );
  }
  if (boot.state === 'signed-out') {
    return (
      <SignIn
        failed={boot.failed}
        busy={busy}
        onSignIn={() => {
          setBusy(true);
          void auth.startSignIn(boot.clientId, window.location.hash).catch(() => {
            setBusy(false);
            signedOut(boot.clientId, true);
          });
        }}
      />
    );
  }
  return (
    <Library
      api={boot.api}
      onSignOut={() => {
        // Signed out locally either way; a failed server logout (e.g. right after account
        // deletion) must not surface as an unhandled rejection.
        void boot.api
          .signOut()
          .catch(() => undefined)
          .finally(() => signedOut(clientId));
      }}
    />
  );
}

function Library({ api, onSignOut }: { api: LibraryApi; onSignOut: () => void }) {
  const route = useRoute();
  const online = useOnline();
  const analytics = useMemo(() => new Analytics(api), [api]);
  useEffect(() => {
    api.getSettings().then(
      (s) => analytics.setOptOut(s.analyticsOptOut),
      () => undefined, // The API still drops events for an opted-out user.
    );
    const hidden = () => {
      if (document.visibilityState === 'hidden') analytics.flush();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      analytics.flush();
    };
  }, [api, analytics]);
  const open = useAsync(() => api.listActionItems('open'), []);
  const refreshCount = open.reload;

  return (
    <ApiContext.Provider value={api}>
      <AnalyticsContext.Provider value={analytics}>
        <ToastProvider>
          <div className="app">
            <Sidebar route={route} openActions={open.data?.length ?? null} />
            <main className="main">
              {!online && (
                // DESIGN §16 offline banner. Pages show what they already loaded; nothing is cached
                // across reloads yet, so the text does not promise saved meetings.
                <div className="offline-banner">
                  <Banner tone="warning">
                    You&rsquo;re offline. Showing what was already loaded; changes need a
                    connection.
                  </Banner>
                </div>
              )}
              {route.screen === 'home' && <Home onActionsChanged={refreshCount} />}
              {route.screen === 'meetings' && <Meetings />}
              {route.screen === 'detail' && (
                <MeetingDetail
                  key={route.meetingId}
                  meetingId={route.meetingId}
                  tab={route.tab}
                  onActionsChanged={refreshCount}
                />
              )}
              {route.screen === 'actions' && <ActionItems onChanged={refreshCount} />}
              {route.screen === 'settings' && <Settings onSignOut={onSignOut} />}
              {route.screen === 'catalogue' && import.meta.env.DEV && <Catalogue />}
            </main>
          </div>
        </ToastProvider>
      </AnalyticsContext.Provider>
    </ApiContext.Provider>
  );
}
