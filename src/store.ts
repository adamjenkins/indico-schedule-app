/**
 * The smallest reactivity primitive that does the job.
 *
 * Everything the app displays lives in IndexedDB, so components do not need a
 * state library — they need to know *when to re-read*. Each named channel is a
 * counter bumped whenever the stored data behind it changes; components
 * subscribe through `useSyncExternalStore` and reload themselves when the
 * channels they read from move.
 *
 * Channels exist because "something changed" is too blunt: a starred talk used
 * to re-read every event, every cached day and every sponsor record on every
 * tap. A hook that reads only stars should only hear about stars. A bump with
 * no channel still means "everything" — that is what a full sync is.
 *
 * Sync status is kept here rather than in the database because it describes the
 * current session (am I fetching right now, did the last attempt fail) and
 * should not survive a reload.
 */
import {ApiError} from './api';

type Listener = () => void;

const CHANNELS = ['events', 'days', 'stars', 'details', 'sponsors', 'branding', 'status'] as const;

export type Channel = (typeof CHANNELS)[number];

const revisions: Record<Channel, number> = {
  events: 0,
  days: 0,
  stars: 0,
  details: 0,
  sponsors: 0,
  branding: 0,
  status: 0,
};

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The combined revision of the named channels — all of them when none are
 * named. Counters only ever grow, so the sum moves whenever any of them does.
 */
export function getRevision(channels?: readonly Channel[]): number {
  let total = 0;
  for (const channel of channels ?? CHANNELS) {
    total += revisions[channel];
  }
  return total;
}

/**
 * Announce that stored data changed and anything reading it should re-read.
 * Name the channels that actually changed; naming none announces all of them.
 */
export function bump(...channels: Channel[]): void {
  for (const channel of channels.length ? channels : CHANNELS) {
    revisions[channel] += 1;
  }
  listeners.forEach(listener => listener());
}

export type SyncPhase = 'idle' | 'syncing' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  error: ApiError | null;
  lastSyncAt: number | null;
}

const IDLE: SyncStatus = {phase: 'idle', error: null, lastSyncAt: null};

const statuses = new Map<number, SyncStatus>();

export function getSyncStatus(eventId: number): SyncStatus {
  return statuses.get(eventId) ?? IDLE;
}

export function setSyncStatus(eventId: number, patch: Partial<SyncStatus>): void {
  statuses.set(eventId, {...getSyncStatus(eventId), ...patch});
  bump('status');
}
