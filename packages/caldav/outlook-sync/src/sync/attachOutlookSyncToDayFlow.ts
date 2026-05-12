import type { CalendarType, EventChange, ICalendarApp } from '@dayflow/core';
import { applyProviderEventsToDayFlow } from '@dayflow/sync-core';
import type {
  OutlookDayFlowOptions,
  OutlookSyncDelta,
  OutlookSyncStatus,
} from '@outlook-sync/types/adapter';
import { getOutlookMeta } from '@outlook-sync/types/meta';

import type { OutlookSync, OutlookSyncRange } from './createOutlookSync';

export type OutlookDayFlowController = {
  /** Load calendars, sync initial events, and start listening for changes. */
  start(): Promise<void>;
  /** Unsubscribe all listeners. */
  stop(): void;
  /** Re-sync a specific calendar or all calendars, optionally for a range. */
  refresh(options?: {
    calendarId?: string;
    range?: { start: Date; end: Date };
  }): Promise<void>;
  /** Current sync status. */
  getStatus(): OutlookSyncStatus;
};

const toISOString = (d: Date) => d.toISOString();

/**
 * Attach an Outlook Calendar sync engine to a DayFlow CalendarApp.
 *
 * The binding:
 * - Optionally hydrates DayFlow from a local cache before the first remote sync
 * - Discovers remote calendars and registers them in DayFlow
 * - Syncs events on startup and on each visible-range change
 * - Observes local event mutations and writes eligible ones back to Outlook Calendar
 * - Applies remote changes with `source: 'remote'` to prevent write-back loops
 * - Fires `onSyncComplete` after each sync with a count of what changed
 * - Fires `onWriteComplete` after each successful write-back
 */
export function attachOutlookSyncToDayFlow(
  app: ICalendarApp,
  sync: OutlookSync,
  options: OutlookDayFlowOptions = {}
): OutlookDayFlowController {
  const {
    writable = true,
    onStatusChange,
    onWriteError,
    getInitialSnapshot,
    onSyncComplete,
    onWriteComplete,
  } = options;

  let status: OutlookSyncStatus = { state: 'idle' };
  const unsubscribers: Array<() => void> = [];
  const knownCalendarIds = new Set<string>();
  let currentRange: { start: Date; end: Date } | undefined;
  let started = false;

  // ─── Status helpers ──────────────────────────────────────────────────────────

  function setStatus(next: OutlookSyncStatus): void {
    status = next;
    onStatusChange?.(next);
  }

  function setSyncing(): void {
    setStatus({ ...status, state: 'syncing' });
  }

  function setIdle(): void {
    setStatus({ state: 'idle', lastSyncedAt: new Date().toISOString() });
  }

  function setError(message: string, calendarId?: string): void {
    setStatus({ ...status, state: 'error', error: { message, calendarId } });
  }

  // ─── Calendar registration ───────────────────────────────────────────────────

  async function loadCalendars(): Promise<{
    added: number;
    updated: number;
    deleted: number;
  }> {
    const calendars = await sync.listCalendars();
    const existingIds = new Set(app.getCalendars().map(c => c.id));
    const nextIds = new Set<string>();
    let added = 0;
    let updated = 0;

    for (const cal of calendars) {
      if (existingIds.has(cal.id)) {
        app.updateCalendar(cal.id, cal);
        updated++;
      } else {
        await app.createCalendar(cal);
        added++;
      }
      nextIds.add(cal.id);
    }

    knownCalendarIds.clear();
    nextIds.forEach(id => knownCalendarIds.add(id));

    return { added, updated, deleted: 0 };
  }

  // ─── Event sync ──────────────────────────────────────────────────────────────

  function toSyncRange(range?: {
    start: Date;
    end: Date;
  }): OutlookSyncRange | undefined {
    if (!range) return undefined;
    return { start: toISOString(range.start), end: toISOString(range.end) };
  }

  async function syncRange(range?: {
    start: Date;
    end: Date;
  }): Promise<OutlookSyncDelta> {
    const delta: OutlookSyncDelta = {
      calendars: { added: 0, updated: 0, deleted: 0 },
      events: { added: 0, updated: 0, deleted: 0 },
    };

    for (const calendarId of knownCalendarIds) {
      const result = await sync.syncEvents(calendarId, toSyncRange(range));

      const eventDelta = applyProviderEventsToDayFlow<string>({
        app,
        events: result.events,
        deleted: result.deleted,
        getProviderEventId: event => getOutlookMeta(event)?.eventId,
        getDeletedEventId: deletedId => deletedId,
        getDeletedProviderEventId: deletedId => deletedId,
      });

      delta.events.added += eventDelta.added;
      delta.events.updated += eventDelta.updated;
      delta.events.deleted += eventDelta.deleted;
    }

    return delta;
  }

  // ─── Write-back eligibility ──────────────────────────────────────────────────

  function shouldWriteBack(change: EventChange): boolean {
    if (!writable) return false;
    if (change.source === 'remote') return false;

    const event = change.type === 'update' ? change.after : change.event;
    const calendarId = event.calendarId;
    if (!calendarId || !knownCalendarIds.has(calendarId)) return false;

    const calendar = app.getCalendars().find(c => c.id === calendarId);
    if (calendar?.readOnly) return false;

    const meta = getOutlookMeta(event);

    // Recurring events: read-only
    if (meta?.isRecurring) return false;

    // delete requires existing outlook meta
    if (change.type === 'delete' && !meta) return false;

    return true;
  }

  // ─── Listeners ───────────────────────────────────────────────────────────────

  function setupEventChangeListener(): void {
    const unsub = app.subscribeEventChanges(async (changes: EventChange[]) => {
      for (const change of changes) {
        if (!shouldWriteBack(change)) continue;

        const event = change.type === 'update' ? change.after : change.event;
        const calendarId = event.calendarId!;
        const meta = getOutlookMeta(event);

        try {
          if (change.type === 'create' || (change.type === 'update' && !meta)) {
            const created = await sync.createEvent(calendarId, event);
            app.applyEventsChanges(
              { update: [{ id: event.id, updates: { meta: created.meta } }] },
              false,
              'remote'
            );
            onWriteComplete?.('create', event);
          } else if (change.type === 'update') {
            const updated = await sync.updateEvent(event);
            app.applyEventsChanges(
              { update: [{ id: event.id, updates: { meta: updated.meta } }] },
              false,
              'remote'
            );
            onWriteComplete?.('update', event);
          } else if (change.type === 'delete') {
            await sync.deleteEvent(event);
            onWriteComplete?.('delete', event);
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          const action = change.type as 'create' | 'update' | 'delete';
          if (onWriteError) {
            onWriteError(error, { action, eventId: meta?.eventId });
          } else {
            console.error(`[outlook-sync] ${action} failed:`, error.message);
          }
        }
      }
    });
    unsubscribers.push(unsub);
  }

  function setupRangeChangeListener(): void {
    const unsub = app.subscribeVisibleRangeChange(async payload => {
      currentRange = { start: payload.start, end: payload.end };
      setSyncing();
      try {
        const delta = await syncRange(currentRange);
        onSyncComplete?.(delta);
        setIdle();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    });
    unsubscribers.push(unsub);
  }

  // ─── Controller ──────────────────────────────────────────────────────────────

  return {
    async start(): Promise<void> {
      if (started) return;
      setSyncing();
      try {
        // Hydrate from local cache before any remote requests
        if (getInitialSnapshot) {
          try {
            const snapshot = await getInitialSnapshot();
            for (const cal of snapshot.calendars) {
              if (
                !app.getCalendars().some((c: CalendarType) => c.id === cal.id)
              ) {
                await app.createCalendar(cal);
              }
              knownCalendarIds.add(cal.id);
            }
            if (snapshot.events.length > 0) {
              app.applyEventsChanges(
                { add: snapshot.events },
                false,
                'remote' as never
              );
            }
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (onWriteError) {
              onWriteError(error, { action: 'create' });
            }
          }
        }

        const calDelta = await loadCalendars();
        const delta = await syncRange(currentRange);
        delta.calendars = calDelta;
        onSyncComplete?.(delta);
        setIdle();
        setupRangeChangeListener();
        setupEventChangeListener();
        started = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    },

    stop(): void {
      unsubscribers.forEach(fn => fn());
      unsubscribers.length = 0;
      started = false;
    },

    async refresh({ calendarId, range } = {}): Promise<void> {
      setSyncing();
      const effectiveRange = range ?? currentRange;
      try {
        if (calendarId) {
          const result = await sync.syncEvents(
            calendarId,
            toSyncRange(effectiveRange)
          );

          const eventDelta = applyProviderEventsToDayFlow<string>({
            app,
            events: result.events,
            deleted: result.deleted,
            getProviderEventId: event => getOutlookMeta(event)?.eventId,
            getDeletedEventId: deletedId => deletedId,
            getDeletedProviderEventId: deletedId => deletedId,
          });

          const delta: OutlookSyncDelta = {
            calendars: { added: 0, updated: 0, deleted: 0 },
            events: {
              added: eventDelta.added,
              updated: eventDelta.updated,
              deleted: eventDelta.deleted,
            },
          };
          onSyncComplete?.(delta);
        } else {
          const calDelta = await loadCalendars();
          const delta = await syncRange(effectiveRange);
          delta.calendars = calDelta;
          onSyncComplete?.(delta);
        }
        setIdle();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg, calendarId);
      }
    },

    getStatus(): OutlookSyncStatus {
      return { ...status };
    },
  };
}
