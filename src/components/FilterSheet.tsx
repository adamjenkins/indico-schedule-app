import {useMemo, useState} from 'react';

import {EMPTY_FILTERS, Filters, filterContributions} from '../filters';
import {BSGridData} from '../types';
import {Sheet} from './Sheet';

/**
 * The filter sheet.
 *
 * Edits a local copy and only commits on "Show", so half-made selections never
 * reach the URL and the Cancel button means something. The counts are computed
 * against the unfiltered day, so they say how much *exists* rather than how
 * much survives the selection being edited — a count that changed as you ticked
 * boxes would make it impossible to plan a selection.
 */
export function FilterSheet({
  gridData,
  filters,
  onApply,
  onClose,
}: {
  gridData: BSGridData;
  filters: Filters;
  onApply: (filters: Filters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Filters>(filters);

  const counts = useMemo(() => {
    const perRoom = new Map<number, number>();
    const perTrack = new Map<number, number>();
    for (const contribution of gridData.scheduled_contributions) {
      if (contribution.column_id !== null) {
        perRoom.set(contribution.column_id, (perRoom.get(contribution.column_id) ?? 0) + 1);
      }
      if (contribution.track_id !== null) {
        perTrack.set(contribution.track_id, (perTrack.get(contribution.track_id) ?? 0) + 1);
      }
    }
    return {perRoom, perTrack};
  }, [gridData]);

  const preview = useMemo(() => filterContributions(gridData, draft), [gridData, draft]);

  const toggle = (key: keyof Filters, id: number) =>
    setDraft(current => {
      const ids = current[key];
      return {
        ...current,
        [key]: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id],
      };
    });

  const roomLabel = (columnId: number) => {
    const column = gridData.columns.find(c => c.id === columnId);
    return column ? column.title || column.label : `Room ${columnId}`;
  };

  return (
    <Sheet label="Filter the schedule" onClose={onClose}>
      <header>
          <h2>Filter</h2>
          <button className="iconbtn" onClick={() => setDraft(EMPTY_FILTERS)}>
            Clear all
          </button>
        </header>

        <div className="scroll">
          {gridData.groups.length > 0 ? (
            <>
              <div className="grouphead">ROOM GROUPS</div>
              {gridData.groups.map(group => (
                <Option
                  key={group.id}
                  checked={draft.groupIds.includes(group.id)}
                  label={group.title}
                  count={`${group.column_ids.length} rooms`}
                  onToggle={() => toggle('groupIds', group.id)}
                />
              ))}
            </>
          ) : null}

          <div className="grouphead">ROOMS</div>
          {gridData.columns.map(column => (
            <Option
              key={column.id}
              checked={draft.roomIds.includes(column.id)}
              label={roomLabel(column.id)}
              count={String(counts.perRoom.get(column.id) ?? 0)}
              onToggle={() => toggle('roomIds', column.id)}
            />
          ))}

          {gridData.tracks.length > 0 ? (
            <>
              <div className="grouphead">TRACKS</div>
              {gridData.tracks.map(track => (
                <Option
                  key={track.id}
                  checked={draft.trackIds.includes(track.id)}
                  label={track.title}
                  count={String(counts.perTrack.get(track.id) ?? 0)}
                  onToggle={() => toggle('trackIds', track.id)}
                />
              ))}
            </>
          ) : null}

          <p className="meta" style={{margin: '14px 0 4px', color: 'var(--muted)', fontSize: 13}}>
            Filtering by track keeps every room that hosts at least one matching talk, and greys
            out that room&rsquo;s other talks rather than hiding them — so you can still see when a
            room is busy.
          </p>
        </div>

        <footer>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" style={{flex: 1}} onClick={() => onApply(draft)}>
            Show {preview.items.length} {preview.items.length === 1 ? 'talk' : 'talks'}
          </button>
      </footer>
    </Sheet>
  );
}

function Option({
  checked,
  label,
  count,
  onToggle,
}: {
  checked: boolean;
  label: string;
  count: string;
  onToggle: () => void;
}) {
  return (
    <button className="option" role="checkbox" aria-checked={checked} onClick={onToggle}>
      <span className={checked ? 'check on' : 'check'} aria-hidden="true">
        ✓
      </span>
      <span>{label}</span>
      <span className="count">{count}</span>
    </button>
  );
}
