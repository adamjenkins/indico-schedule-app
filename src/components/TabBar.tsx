import {ReactNode} from 'react';

import {Route, navigate} from '../router';
import {IconEvents, IconSchedule, IconSearch, IconStar} from './Icons';

const TABS: {key: string; icon: ReactNode; label: string; to: string}[] = [
  {key: 'events', icon: <IconEvents />, label: 'Events', to: ''},
  {key: 'schedule', icon: <IconSchedule />, label: 'Schedule', to: 'schedule'},
  {key: 'agenda', icon: <IconStar />, label: 'My agenda', to: 'agenda'},
  {key: 'search', icon: <IconSearch />, label: 'Search', to: 'search'},
];

/**
 * The Schedule tab needs somewhere to go, and which event that is depends on
 * where the user last was — so it is passed in rather than guessed at here.
 */
export function TabBar({route, scheduleHref}: {route: Route; scheduleHref: string | null}) {
  const current =
    route.name === 'talk' ? 'schedule' : route.name === 'settings' ? 'events' : route.name;

  return (
    <nav className="tabbar">
      {TABS.map(tab => {
        const target = tab.key === 'schedule' ? scheduleHref : tab.to;
        const disabled = target === null;
        const active = current === tab.key;
        return (
          <button
            key={tab.key}
            aria-current={active ? 'page' : undefined}
            disabled={disabled}
            onClick={() => target !== null && navigate(target)}
          >
            <span className="glyph">
              {tab.key === 'agenda' ? <IconStar filled={active} /> : tab.icon}
            </span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
