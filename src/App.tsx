import {useEffect, useLayoutEffect, useRef, useState} from 'react';

import {AgendaScreen} from './components/AgendaScreen';
import {EventsScreen} from './components/EventsScreen';
import {IconBack, IconSettings} from './components/Icons';
import {InstallSheet} from './components/InstallSheet';
import {PullToRefresh} from './components/PullToRefresh';
import {ScheduleScreen} from './components/ScheduleScreen';
import {SearchScreen} from './components/SearchScreen';
import {SettingsScreen} from './components/SettingsScreen';
import {EmptyState} from './components/States';
import {TabBar} from './components/TabBar';
import {TalkScreen} from './components/TalkScreen';
import {useEventRecord, useEvents, useOnline} from './hooks';
import {BASE, goBack, navigate, Route, useRoute} from './router';
import {syncAll, syncEvent} from './sync';

/** Remembered so the Schedule tab has somewhere to go from anywhere in the app. */
const LAST_EVENT_KEY = 'indico-schedule:last-event';

/**
 * How deep a screen sits, which is what decides whether a navigation animates
 * forwards or backwards. Tabs are all at the same level, so switching between
 * them cross-fades instead of sliding — sliding sideways between peers is the
 * thing that makes web apps feel like they are guessing.
 */
function depthOf(route: Route): number {
  switch (route.name) {
    case 'talk':
      return 2;
    case 'schedule':
    case 'settings':
      return 1;
    default:
      return 0;
  }
}

/** Identifies a screen for scroll-position purposes. */
function scrollKeyOf(route: Route): string {
  switch (route.name) {
    case 'schedule':
      return `schedule:${route.eventId}:${route.day ?? ''}`;
    case 'talk':
      return `talk:${route.eventId}:${route.contributionId}`;
    case 'search':
      return 'search';
    default:
      return route.name;
  }
}

export function App() {
  const route = useRoute();
  const online = useOnline();
  const {data: events} = useEvents();
  const mainRef = useRef<HTMLElement>(null);
  const [lastEventId, setLastEventId] = useState<number | null>(() => {
    const stored = localStorage.getItem(LAST_EVENT_KEY);
    return stored ? Number(stored) : null;
  });

  useEffect(() => {
    if (route.name === 'schedule' || route.name === 'talk') {
      localStorage.setItem(LAST_EVENT_KEY, String(route.eventId));
      setLastEventId(route.eventId);
    }
  }, [route]);

  // -- transition direction ------------------------------------------------
  const depth = depthOf(route);
  const previousDepth = useRef(depth);
  const direction = depth > previousDepth.current ? 'push' : depth < previousDepth.current ? 'pop' : 'fade';
  useEffect(() => {
    previousDepth.current = depth;
  }, [depth]);

  // -- scroll restoration --------------------------------------------------
  // Returning from a talk to the middle of a 200-row schedule and landing back
  // at the top is the single most page-like thing an app can do.
  const scrollKey = scrollKeyOf(route);
  const positions = useRef(new Map<string, number>());
  const previousKey = useRef(scrollKey);
  useLayoutEffect(() => {
    const node = mainRef.current;
    if (!node) {
      return;
    }
    if (previousKey.current !== scrollKey) {
      previousKey.current = scrollKey;
      node.scrollTop = positions.current.get(scrollKey) ?? 0;
    }
    const remember = () => positions.current.set(scrollKey, node.scrollTop);
    node.addEventListener('scroll', remember, {passive: true});
    return () => node.removeEventListener('scroll', remember);
  }, [scrollKey]);

  const known = new Set((events ?? []).map(event => event.id));
  const scheduleEventId =
    lastEventId !== null && known.has(lastEventId) ? lastEventId : (events?.[0]?.id ?? null);

  const refresh = async () => {
    if (route.name === 'schedule' || route.name === 'talk') {
      await syncEvent(route.eventId);
    } else {
      await syncAll();
    }
  };

  return (
    <div className="app">
      <AppBar route={route} online={online} />
      <main className="main" ref={mainRef}>
        <PullToRefresh onRefresh={refresh} scrollRef={mainRef}>
          <div key={scrollKey} className={`screen ${direction}`}>
            <Screen route={route} />
          </div>
        </PullToRefresh>
      </main>
      <TabBar
        route={route}
        scheduleHref={scheduleEventId === null ? null : `event/${scheduleEventId}`}
      />
      <InstallSheet />
    </div>
  );
}

function Screen({route}: {route: Route}) {
  switch (route.name) {
    case 'events':
      return <EventsScreen />;
    case 'schedule':
      return <ScheduleScreen eventId={route.eventId} day={route.day} search={route.search} />;
    case 'talk':
      return (
        <TalkScreen eventId={route.eventId} day={route.day} contributionId={route.contributionId} />
      );
    case 'agenda':
      return <AgendaScreen />;
    case 'search':
      return <SearchScreen query={route.query} />;
    case 'settings':
      return <SettingsScreen />;
    case 'notfound':
      return (
        <EmptyState
          glyph="🧭"
          title="Nothing here"
          action={
            <button className="btn ghost" onClick={() => navigate(BASE)}>
              Go to my events
            </button>
          }
        >
          <code>{route.path}</code> is not a page in this app.
        </EmptyState>
      );
  }
}

function AppBar({route, online}: {route: Route; online: boolean}) {
  const eventId = route.name === 'schedule' || route.name === 'talk' ? route.eventId : null;
  const {data: event} = useEventRecord(eventId ?? -1);

  const back = route.name === 'talk' || route.name === 'settings';
  const title =
    route.name === 'events'
      ? 'My events'
      : route.name === 'schedule'
        ? 'Schedule'
        : route.name === 'talk'
          ? 'Talk'
          : route.name === 'agenda'
            ? 'My agenda'
            : route.name === 'search'
              ? 'Search'
              : route.name === 'settings'
                ? 'Settings'
                : 'Schedule';

  const subtitle =
    (route.name === 'schedule' || route.name === 'talk') && event ? event.title : undefined;

  return (
    <header className="appbar">
      {back ? (
        <button className="iconbtn" aria-label="Back" onClick={() => goBack()}>
          <IconBack />
          Back
        </button>
      ) : null}
      <h1>
        {title}
        {subtitle ? <small>{subtitle}</small> : null}
        {!online && !subtitle ? <small>Offline — showing saved data</small> : null}
      </h1>
      {!back ? (
        <button className="iconbtn" aria-label="Settings" onClick={() => navigate('settings')}>
          <IconSettings />
        </button>
      ) : null}
    </header>
  );
}
