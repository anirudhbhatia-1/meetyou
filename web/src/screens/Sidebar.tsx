import { Icon, type IconName } from '@meetyou/ui';
import { href, type Route } from '../lib/router.ts';

const ITEMS: { screen: Route['screen']; label: string; icon: IconName; to: Route }[] = [
  { screen: 'home', label: 'Home', icon: 'house', to: { screen: 'home' } },
  { screen: 'meetings', label: 'Meetings', icon: 'align-left', to: { screen: 'meetings' } },
  { screen: 'actions', label: 'Action items', icon: 'square-check', to: { screen: 'actions' } },
  { screen: 'settings', label: 'Settings', icon: 'settings', to: { screen: 'settings' } },
];

/** DESIGN §3: 248 px sidebar; Meeting detail highlights Meetings. */
export function Sidebar({ route, openActions }: { route: Route; openActions: number | null }) {
  const current = route.screen === 'detail' ? 'meetings' : route.screen;
  return (
    <nav className="sidebar" aria-label="Main">
      <a className="wordmark" href={href({ screen: 'home' })}>
        Minutes
      </a>
      <ul>
        {ITEMS.map((item) => (
          <li key={item.screen}>
            <a
              href={href(item.to)}
              className={`nav-item ${current === item.screen ? 'nav-on' : ''}`}
              aria-current={current === item.screen ? 'page' : undefined}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.screen === 'actions' && openActions !== null && openActions > 0 && (
                <span className="nav-count" aria-label={`${openActions} open`}>
                  {openActions}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
