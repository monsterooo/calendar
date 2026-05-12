import { getCalDAVMeta } from '@caldav/mapper/meta';
import {
  createNamespacedCalDAVEventId,
  mapCalDAVEventToDayFlow,
} from '@caldav/mapper/toEvent';
import type { CalDAVCalendar } from '@caldav/types/calendar';
import type { CalDAVDeletedEvent, CalDAVRemoteRef } from '@caldav/types/event';
import type { Event, EventChange, ICalendarApp } from '@dayflow/core';
import { applyProviderEventsToDayFlow } from '@dayflow/sync-core';

import { mapCalDAVCalendarToDayFlow } from './mapCalendar';
import type {
  CalDAVDayFlowController,
  CalDAVDayFlowOptions,
  CalDAVErrorContext,
  CalDAVSync,
  CalDAVSyncDelta,
  CalDAVSyncStatus,
} from './types';

/**
 * Attach a CalDAV sync engine to a DayFlow CalendarApp.
 *
 * The binding:
 * - Optionally hydrates DayFlow from a local cache before the first remote sync
 * - Discovers remote calendars and registers them in DayFlow
 * - Syncs events on startup and on each visible-range change
 * - Observes local DayFlow event mutations and writes eligible ones back to CalDAV
 * - Applies remote changes with `source: 'remote'` to prevent write-back loops
 * - Fires `onSyncComplete` after each sync with a count of what changed
 * - Fires `onWriteComplete` after each successful write-back
 *
 * Accepted by `ICalendarApp`, so it works with any DayFlow framework adapter.
 */
function resolveEvent(change: EventChange) {
  return change.type === 'update' ? change.after : change.event; // create or delete
}

export function attachCalDAVToDayFlow(
  app: ICalendarApp,
  sync: CalDAVSync,
  options: CalDAVDayFlowOptions = {}
): CalDAVDayFlowController {
  const {
    writable = true,
    refreshOnVisibleRangeChange = true,
    eventMode = { recurring: 'read-only' },
    onError,
    getInitialSnapshot,
    onSyncComplete,
    onWriteComplete,
    createEventId = createNamespacedCalDAVEventId,
  } = options;

  let status: CalDAVSyncStatus = { state: 'idle' };
  const unsubscribers: Array<() => void> = [];
  const knownCalendarIds = new Set<string>();
  const remoteCalendars = new Map<string, CalDAVCalendar>();
  let currentRange: { start: Date; end: Date } | undefined;
  let started = false;

  // ─── Status helpers ─────────────────────────────────────────────────────────

  function setSyncing(): void {
    status = { ...status, state: 'syncing' };
  }

  function setIdle(): void {
    status = { state: 'idle', lastSyncedAt: new Date() };
  }

  function setError(error: unknown, context: CalDAVErrorContext): void {
    status = { ...status, state: 'error', error };
    onError?.(error, context);
  }

  // ─── Calendar registration ───────────────────────────────────────────────────

  async function loadCalendars(): Promise<void> {
    const remote = await sync.listCalendars();
    const existingIds = new Set(app.getCalendars().map(c => c.id));
    const nextCalendarIds = new Set<string>();
    const nextCalendars = new Map<string, CalDAVCalendar>();

    for (const cal of remote) {
      const dayflowCal = mapCalDAVCalendarToDayFlow(cal);
      if (existingIds.has(cal.id)) {
        app.updateCalendar(cal.id, dayflowCal);
      } else {
        await app.createCalendar(dayflowCal);
      }
      nextCalendarIds.add(cal.id);
      nextCalendars.set(cal.id, cal);
    }

    knownCalendarIds.clear();
    nextCalendarIds.forEach(id => knownCalendarIds.add(id));
    remoteCalendars.clear();
    nextCalendars.forEach((cal, id) => remoteCalendars.set(id, cal));
  }

  // ─── Event sync ──────────────────────────────────────────────────────────────

  async function syncRange(
    range: { start: Date; end: Date } | undefined,
    _context: Pick<CalDAVErrorContext, 'operation'>
  ): Promise<CalDAVSyncDelta> {
    const delta: CalDAVSyncDelta = {
      calendars: { added: 0, updated: 0, deleted: 0 },
      events: { added: 0, updated: 0, deleted: 0 },
    };

    for (const calendarId of knownCalendarIds) {
      const result = await sync.syncEvents({ calendarId, range });

      const events = result.events
        .map(data => mapCalDAVEventToDayFlow(data, { createEventId }))
        .filter((event): event is Event => event !== null);

      const eventDelta = applyProviderEventsToDayFlow<CalDAVDeletedEvent>({
        app,
        events,
        deleted: result.deleted,
        getProviderEventId: event => getCalDAVMeta(event)?.href,
        getDeletedProviderEventId: deleted => deleted.href,
      });

      delta.events.added += eventDelta.added;
      delta.events.updated += eventDelta.updated;
      delta.events.deleted += eventDelta.deleted;
    }

    return delta;
  }

  // ─── Write-back eligibility ──────────────────────────────────────────────────

  function isCalendarWritable(
    calendarId: string | undefined,
    operation: EventChange['type']
  ): boolean {
    if (!writable || !calendarId) return false;
    if (!knownCalendarIds.has(calendarId)) return false;
    const dayflowCalendar = app.getCalendars().find(c => c.id === calendarId);
    if (!dayflowCalendar || dayflowCalendar.readOnly) return false;

    const remoteCalendar = remoteCalendars.get(calendarId);
    if (remoteCalendar?.readOnly) return false;

    const permissions = remoteCalendar?.permissions;
    if (!permissions) {
      return remoteCalendar?.readOnly === false;
    }

    if (operation === 'create') return permissions.canCreate === true;
    if (operation === 'update') return permissions.canUpdate === true;
    return permissions.canDelete === true;
  }

  function shouldWriteBack(change: EventChange): boolean {
    if (change.source === 'remote') return false;

    const event = resolveEvent(change);

    if (!isCalendarWritable(event.calendarId, change.type)) return false;

    const meta = getCalDAVMeta(event);
    const recurringMode = eventMode.recurring ?? 'read-only';

    if (meta?.isRecurring && recurringMode === 'read-only') return false;

    if ((change.type === 'update' || change.type === 'delete') && !meta?.href) {
      return false;
    }

    return true;
  }

  // ─── Listeners ───────────────────────────────────────────────────────────────

  function setupEventChangeListener(): void {
    const unsub = app.subscribeEventChanges(async (changes: EventChange[]) => {
      for (const change of changes) {
        if (!shouldWriteBack(change)) continue;

        const event = resolveEvent(change);
        const calendarId = event.calendarId!;
        const meta = getCalDAVMeta(event);

        try {
          if (change.type === 'create') {
            const uid = meta?.uid ?? event.id;
            const eventToCreate = meta
              ? event
              : {
                  ...event,
                  meta: {
                    ...event.meta,
                    caldav: {
                      uid,
                      href: '',
                      calendarId,
                      isRecurring: false,
                    },
                  },
                };
            const result = await sync.createEvent({
              calendarId,
              event: eventToCreate,
            });
            app.applyEventsChanges(
              {
                update: [
                  {
                    id: event.id,
                    updates: {
                      meta: {
                        ...event.meta,
                        caldav: {
                          uid,
                          href: result.href,
                          etag: result.etag,
                          calendarId,
                          isRecurring: false,
                        },
                      },
                    },
                  },
                ],
              },
              false,
              'remote'
            );
            onWriteComplete?.('create', event);
          } else if (change.type === 'update') {
            const remote: CalDAVRemoteRef = {
              calendarId: meta!.calendarId,
              uid: meta!.uid,
              href: meta!.href,
              etag: meta!.etag,
            };
            const result = await sync.updateEvent({
              calendarId,
              event,
              remote,
            });
            app.applyEventsChanges(
              {
                update: [
                  {
                    id: event.id,
                    updates: {
                      meta: {
                        ...event.meta,
                        caldav: {
                          ...meta!,
                          href: result.href,
                          etag: result.etag,
                        },
                      },
                    },
                  },
                ],
              },
              false,
              'remote'
            );
            onWriteComplete?.('update', event);
          } else if (change.type === 'delete') {
            const remote: CalDAVRemoteRef = {
              calendarId: meta!.calendarId,
              uid: meta!.uid,
              href: meta!.href,
              etag: meta!.etag,
            };
            await sync.deleteEvent({ calendarId, remote });
            onWriteComplete?.('delete', event);
          }
        } catch (err) {
          setError(err, {
            operation: change.type,
            calendarId,
            eventId: event.id,
          });
        }
      }
    });
    unsubscribers.push(unsub);
  }

  function setupRangeChangeListener(): void {
    if (!refreshOnVisibleRangeChange) return;

    const unsub = app.subscribeVisibleRangeChange(async payload => {
      currentRange = { start: payload.start, end: payload.end };
      setSyncing();
      try {
        const delta = await syncRange(currentRange, {
          operation: 'range-sync',
        });
        onSyncComplete?.(delta);
        setIdle();
      } catch (err) {
        setError(err, { operation: 'range-sync' });
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
              if (!app.getCalendars().some(c => c.id === cal.id)) {
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
            onError?.(err, { operation: 'initial-sync' });
          }
        }

        await loadCalendars();
        const delta = await syncRange(currentRange, {
          operation: 'initial-sync',
        });
        onSyncComplete?.(delta);
        setIdle();
        setupRangeChangeListener();
        setupEventChangeListener();
        started = true;
      } catch (err) {
        setError(err, { operation: 'initial-sync' });
      }
    },

    stop(): void {
      unsubscribers.forEach(fn => fn());
      unsubscribers.length = 0;
      started = false;
    },

    async refresh({
      calendarId,
      range,
    }: {
      calendarId?: string;
      range?: { start: Date; end: Date };
    } = {}): Promise<void> {
      setSyncing();
      const effectiveRange = range ?? currentRange;
      try {
        if (calendarId) {
          const result = await sync.syncEvents({
            calendarId,
            range: effectiveRange,
          });
          const events = result.events
            .map(data => mapCalDAVEventToDayFlow(data, { createEventId }))
            .filter((event): event is Event => event !== null);
          const eventDelta = applyProviderEventsToDayFlow<CalDAVDeletedEvent>({
            app,
            events,
            deleted: result.deleted,
            getProviderEventId: event => getCalDAVMeta(event)?.href,
            getDeletedProviderEventId: deleted => deleted.href,
          });
          const delta: CalDAVSyncDelta = {
            calendars: { added: 0, updated: 0, deleted: 0 },
            events: {
              added: eventDelta.added,
              updated: eventDelta.updated,
              deleted: eventDelta.deleted,
            },
          };
          onSyncComplete?.(delta);
        } else {
          await loadCalendars();
          const delta = await syncRange(effectiveRange, {
            operation: 'range-sync',
          });
          onSyncComplete?.(delta);
        }
        setIdle();
      } catch (err) {
        setError(err, { operation: 'range-sync', calendarId });
      }
    },

    getStatus(): CalDAVSyncStatus {
      return { ...status };
    },
  };
}
