import { useMemo } from 'react';

import { createMockApi } from './api/mock.ts';
import { ToastProvider } from '@meetyou/ui';
import { ApiContext } from './lib/api-context.ts';
import { useRoute } from './lib/router.ts';
import { useAsync } from './lib/useAsync.ts';
import { ActionItems } from './screens/ActionItems.tsx';
import { Home } from './screens/Home.tsx';
import { MeetingDetail } from './screens/MeetingDetail.tsx';
import { Meetings } from './screens/Meetings.tsx';
import { Settings } from './screens/Settings.tsx';
import { Sidebar } from './screens/Sidebar.tsx';

/** Library web app shell (DESIGN §3). TODO(S4-03/S4-14): sign-in gate and the real API client. */
export function App() {
  const api = useMemo(() => createMockApi(), []);
  const route = useRoute();
  const open = useAsync(() => api.listActionItems('open'), []);
  const refreshCount = open.reload;

  return (
    <ApiContext.Provider value={api}>
      <ToastProvider>
        <div className="app">
          <Sidebar route={route} openActions={open.data?.length ?? null} />
          <main className="main">
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
            {route.screen === 'settings' && <Settings />}
          </main>
        </div>
      </ToastProvider>
    </ApiContext.Provider>
  );
}
