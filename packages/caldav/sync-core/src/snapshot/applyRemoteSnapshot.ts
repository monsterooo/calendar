import type { CalendarType, Event, ICalendarApp } from '@dayflow/core';

export type RemoteSnapshotOptions = {
  /**
   * Return true if this event is managed by the current provider.
   * Used to identify which existing app events should be removed when
   * they no longer appear in the remote snapshot.
   */
  isOwnedEvent(event: Event): boolean;

  /**
   * Return true if this calendar is managed by the current provider.
   * Used to identify which existing app calendars should be removed when
   * they no longer appear in the remote snapshot.
   */
  isOwnedCalendar(calendar: CalendarType): boolean;

  /**
   * Called when a remote event already exists locally.
   * Return the event to write to DayFlow.
   *
   * Defaults to remote-wins. Override to preserve local edits during
   * optimistic sync.
   */
  resolveConflict?: (remote: Event, local: Event) => Event;

  /**
   * Delete owned local calendars that are missing from the snapshot.
   *
   * Defaults to true for backward compatibility. Set false when the snapshot is
   * partial, such as a filtered or range-scoped provider response.
   */
  deleteMissingCalendars?: boolean;

  /**
   * Delete owned local events that are missing from the snapshot.
   *
   * Defaults to true for backward compatibility. Set false when the snapshot is
   * partial, such as a visible-range sync.
   */
  deleteMissingEvents?: boolean;
};

export type RemoteSnapshotDelta = {
  calendars: { added: number; updated: number; deleted: number };
  events: { added: number; updated: number; deleted: number };
};

/**
 * Reconcile a remote snapshot into a DayFlow CalendarApp.
 *
 * Computes the diff between the incoming snapshot and the current app state,
 * then applies adds, updates, and deletes with `source: 'remote'` to prevent
 * write-back loops.
 */
export async function applyRemoteSnapshot(
  app: ICalendarApp,
  snapshot: { events: Event[]; calendars: CalendarType[] },
  options: RemoteSnapshotOptions
): Promise<RemoteSnapshotDelta> {
  const { isOwnedEvent, isOwnedCalendar } = options;
  const resolve = options.resolveConflict ?? (remote => remote);
  const deleteMissingCalendars = options.deleteMissingCalendars ?? true;
  const deleteMissingEvents = options.deleteMissingEvents ?? true;

  const nextCalendarIds = new Set(snapshot.calendars.map(c => c.id));
  const existingOwnedCalendars = app.getCalendars().filter(isOwnedCalendar);
  const calDelta = { added: 0, updated: 0, deleted: 0 };

  for (const cal of snapshot.calendars) {
    if (app.getCalendars().some(c => c.id === cal.id)) {
      app.updateCalendar(cal.id, cal, true);
      calDelta.updated++;
    } else {
      await app.createCalendar(cal);
      calDelta.added++;
    }
  }

  if (deleteMissingCalendars) {
    for (const existing of existingOwnedCalendars) {
      if (!nextCalendarIds.has(existing.id)) {
        await app.deleteCalendar(existing.id);
        calDelta.deleted++;
      }
    }
  }

  const nextEventsById = new Map(snapshot.events.map(e => [e.id, e]));
  const allCurrentEvents = app.getAllEvents();
  const currentById = new Map(allCurrentEvents.map(e => [e.id, e]));
  const currentOwnedEvents = allCurrentEvents.filter(isOwnedEvent);

  const adds: Event[] = [];
  const updates: Array<{ id: string; updates: Partial<Event> }> = [];
  const deletes: string[] = [];

  for (const remote of snapshot.events) {
    const local = currentById.get(remote.id);
    if (local) {
      updates.push({ id: local.id, updates: resolve(remote, local) });
    } else {
      adds.push(remote);
    }
  }

  if (deleteMissingEvents) {
    for (const local of currentOwnedEvents) {
      if (!nextEventsById.has(local.id)) {
        deletes.push(local.id);
      }
    }
  }

  if (adds.length > 0 || updates.length > 0 || deletes.length > 0) {
    app.applyEventsChanges(
      {
        ...(adds.length > 0 ? { add: adds } : {}),
        ...(updates.length > 0 ? { update: updates } : {}),
        ...(deletes.length > 0 ? { delete: deletes } : {}),
      },
      false,
      'remote' as never
    );
  }

  return {
    calendars: calDelta,
    events: {
      added: adds.length,
      updated: updates.length,
      deleted: deletes.length,
    },
  };
}
