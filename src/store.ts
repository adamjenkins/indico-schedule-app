/**
 * The smallest reactivity primitive that does the job.
 *
 * Everything the app displays lives in IndexedDB, so components do not need a
 * state library — they need to know *when to re-read*. `revision` is a counter
 * bumped whenever stored data changes; components subscribe to it through
 * `useSyncExternalStore` and reload themselves when it moves.
 *
 * Sync status is kept here rather than in the database because it describes the
 * current session (am I fetching right now, did the last attempt fail) and
 * should not survive a reload.
 */
import {ApiError} from './api';

type Listener = () => void;

let revision = 0;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRevision(): number {
  return revision;
}

/** Announce that stored data changed and anything reading it should re-read. */
export function bump(): void {
  revision += 1;
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
  bump();
}
