import { useEffect, useState } from 'react';

/** DESIGN §3 / §18 screens. Hash routes keep the static build host-agnostic (ADR-0006 pending). */
export type Route =
  | { screen: 'home' }
  | { screen: 'meetings' }
  | { screen: 'detail'; meetingId: string; tab: 'notes' | 'transcript' }
  | { screen: 'actions' }
  | { screen: 'settings' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'meetings': {
      const id = parts[1];
      if (id === undefined) return { screen: 'meetings' };
      return {
        screen: 'detail',
        meetingId: id,
        tab: parts[2] === 'transcript' ? 'transcript' : 'notes',
      };
    }
    case 'action-items':
      return { screen: 'actions' };
    case 'settings':
      return { screen: 'settings' };
    default:
      return { screen: 'home' };
  }
}

export function href(route: Route): string {
  switch (route.screen) {
    case 'home':
      return '#/';
    case 'meetings':
      return '#/meetings';
    case 'detail':
      return `#/meetings/${encodeURIComponent(route.meetingId)}${route.tab === 'transcript' ? '/transcript' : ''}`;
    case 'actions':
      return '#/action-items';
    case 'settings':
      return '#/settings';
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
