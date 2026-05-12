import type { CalendarType, EventChange, ICalendarApp } from '@dayflow/core';
import { applyProviderEventsToDayFlow } from '@dayflow/sync-core';
import type {
  GoogleDayFlowOptions,
  GoogleSyncDelta,
  GoogleSyncStatus,
} from '@google-sync/types/adapter';
import { getGoogleMeta } from '@google-sync/types/meta';

import type { GoogleSync } from './createGoogleSync';

export type GoogleDayFlowController = {
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
  getStatus(): GoogleSyncStatus;
};

/**
 * Attach a Google Calendar sync engine to a DayFlow CalendarApp.
 *
 * The binding:
 * - Optionally hydrates DayFlow from a local cache before the first remote sync
 * - Discovers remote calendars and registers them in DayFlow
 * - Syncs events on startup and on each visible-range change
 * - Observes local event mutations and writes eligible ones back to Google Calendar
 * - Applies remote changes with `source: 'remote'` to prevent write-back loops
 * - Fires `onSyncComplete` after each sync with a count of what changed
 * - Fires `onWriteComplete` after each successful write-back
 */
const toTimeString = (d: Date) => d.toISOString();

export function attachGoogleSyncToDayFlow(
  app: ICalendarApp,
  sync: GoogleSync,
  options: GoogleDayFlowOptions = {}
): GoogleDayFlowController {
  const {
    writable = true,
    onWriteError,
    onStatusChange,
    getInitialSnapshot,
    onSyncComplete,
    onWriteComplete,
  } = options;

  let status: GoogleSyncStatus = { state: 'idle' };
  const unsubscribers: Array<() => void> = [];
  const knownCalendarIds = new Set<string>();
  const syncTokens = new Map<string, string>(); // calendarId → syncToken
  let currentRange: { start: Date; end: Date } | undefined;
  let started = false;

  // ─── Status helpers ──────────────────────────────────────────────────────────

  function setStatus(next: GoogleSyncStatus): void {
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

  async function syncRange(range?: {
    start: Date;
    end: Date;
  }): Promise<GoogleSyncDelta> {
    const delta: GoogleSyncDelta = {
      calendars: { added: 0, updated: 0, deleted: 0 },
      events: { added: 0, updated: 0, deleted: 0 },
    };

    for (const calendarId of knownCalendarIds) {
      const result = await sync.syncEvents(
        calendarId,
        range
          ? { start: toTimeString(range.start), end: toTimeString(range.end) }
          : undefined
      );

      const eventDelta = applyProviderEventsToDayFlow<string>({
        app,
        events: result.events,
        deleted: result.deleted,
        getProviderEventId: event => getGoogleMeta(event)?.eventId,
        getDeletedEventId: deletedId => deletedId,
        getDeletedProviderEventId: deletedId => deletedId,
      });

      delta.events.added += eventDelta.added;
      delta.events.updated += eventDelta.updated;
      delta.events.deleted += eventDelta.deleted;

      if (result.syncToken) {
        syncTokens.set(calendarId, result.syncToken);
      }
    }

    return delta;
  }

  async function incrementalSync(): Promise<void> {
    for (const calendarId of knownCalendarIds) {
      const token = syncTokens.get(calendarId);
      if (!token) continue;

      const result = await sync.syncEvents(calendarId, undefined, token);

      applyProviderEventsToDayFlow<string>({
        app,
        events: result.events,
        deleted: result.deleted,
        getProviderEventId: event => getGoogleMeta(event)?.eventId,
        getDeletedEventId: deletedId => deletedId,
        getDeletedProviderEventId: deletedId => deletedId,
      });

      if (result.syncToken) {
        syncTokens.set(calendarId, result.syncToken);
      }
    }
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

    const meta = getGoogleMeta(event);

    if (meta?.isRecurring) return false;

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
        const meta = getGoogleMeta(event);

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
            console.error(`[google-sync] ${action} failed:`, error.message);
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
            effectiveRange
              ? {
                  start: toTimeString(effectiveRange.start),
                  end: toTimeString(effectiveRange.end),
                }
              : undefined
          );

          const eventDelta = applyProviderEventsToDayFlow<string>({
            app,
            events: result.events,
            deleted: result.deleted,
            getProviderEventId: event => getGoogleMeta(event)?.eventId,
            getDeletedEventId: deletedId => deletedId,
            getDeletedProviderEventId: deletedId => deletedId,
          });
          if (result.syncToken) syncTokens.set(calendarId, result.syncToken);

          const delta: GoogleSyncDelta = {
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

    getStatus(): GoogleSyncStatus {
      return { ...status };
    },

    // Exposed for testing — not part of public interface
    _incrementalSync: incrementalSync,
  } as GoogleDayFlowController & { _incrementalSync: () => Promise<void> };
}
