/**
 * Loading, empty and failure screens.
 *
 * Failures get named rather than lumped together, because the right response
 * differs completely: being offline needs reassurance that the cached copy is
 * still there, a 403 needs a sign-in button, and a broken payload needs to say
 * so plainly instead of blaming the network.
 */
import {ReactNode} from 'react';

import {ApiError, loginUrl} from '../api';

/**
 * The one storage failure, shared by every screen that reads the database.
 * A hook rejection carries whatever IndexedDB threw, which is unprintable;
 * these are the words that should reach the screen instead.
 */
export const STORAGE_ERROR = new ApiError(
  'storage',
  'This device is not letting the app save data'
);

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function EmptyState({
  glyph,
  title,
  children,
  action,
}: {
  glyph: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="glyph" aria-hidden="true">
        {glyph}
      </div>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/**
 * `hasCache` changes the tone entirely: with a cached copy behind it, a failed
 * refresh is a footnote; without one, it is the whole screen.
 */
export function ErrorState({
  error,
  onRetry,
  hasCache = false,
}: {
  error: ApiError;
  onRetry?: () => void;
  hasCache?: boolean;
}) {
  if (error.kind === 'auth') {
    return (
      <EmptyState
        glyph="🔒"
        title="You cannot see this schedule"
        action={
          <a className="btn" href={loginUrl()}>
            Sign in to Indico
          </a>
        }
      >
        Either you are not signed in, or this event is not open to your account. Signing in is
        handled by Indico itself.
      </EmptyState>
    );
  }

  if (error.kind === 'offline') {
    return (
      <EmptyState
        glyph="📡"
        title="No connection"
        action={onRetry ? <button className="btn ghost" onClick={onRetry}>Try again</button> : undefined}
      >
        {hasCache
          ? 'Showing the copy saved on this device. It will refresh by itself once you are back online.'
          : 'Nothing has been saved for this event yet, so there is nothing to show offline.'}
      </EmptyState>
    );
  }

  if (error.kind === 'notfound') {
    // The address that 404ed belongs to the Block Schedule plugin, and it answers
    // the same way whether the event does not exist, has been deleted, or simply
    // has the feature switched off. From here those are one situation: there is
    // no block schedule at this address.
    return (
      <EmptyState glyph="🔍" title="No schedule at that address">
        Indico has no event with that id, or its Block Schedule feature is not switched on.
      </EmptyState>
    );
  }

  if (error.kind === 'noschedule') {
    return (
      <EmptyState glyph="🗓" title="No schedule set up">
        This event exists, but nobody has configured a block schedule for it — so there is nothing
        for this app to show. It will appear here once the organisers set one up.
      </EmptyState>
    );
  }

  if (error.kind === 'storage') {
    // Not a network fault at all: IndexedDB refused. Naming the cause matters,
    // because the empty states this replaces ("No events yet") would invite the
    // user to re-add everything into a store that cannot hold it.
    return (
      <EmptyState
        glyph="⚠️"
        title="This device is not letting the app save data"
        action={onRetry ? <button className="btn ghost" onClick={onRetry}>Try again</button> : undefined}
      >
        The app keeps schedules in this browser&rsquo;s storage, and the browser refused to read
        it. Private browsing, Lockdown Mode and a full disk can all do this. Nothing is lost on
        the server.
      </EmptyState>
    );
  }

  if (error.kind === 'contract') {
    return (
      <EmptyState
        glyph="⚠️"
        title="Unexpected response"
        action={onRetry ? <button className="btn ghost" onClick={onRetry}>Try again</button> : undefined}
      >
        {error.message}. This usually means the Block Schedule plugin on the server is a different
        version from the one this app expects.
      </EmptyState>
    );
  }

  return (
    <EmptyState
      glyph="⚠️"
      title="Something went wrong"
      action={onRetry ? <button className="btn ghost" onClick={onRetry}>Try again</button> : undefined}
    >
      {error.message}
    </EmptyState>
  );
}

/** A one-line note above content that is still perfectly usable. */
export function Banner({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'bad';
  children: ReactNode;
  action?: {label: string; onClick: () => void};
}) {
  const cls = tone === 'info' ? 'banner' : `banner ${tone}`;
  return (
    <div className={cls}>
      <span>{children}</span>
      {action ? <button onClick={action.onClick}>{action.label}</button> : null}
    </div>
  );
}
