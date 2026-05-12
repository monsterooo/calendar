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
  calendars: {
    added: number;
    updated: number;
    deleted: number;
  };
  events: {
    added: number;
    updated: number;
    deleted: number;
  };
};
/**
 * Reconcile a remote snapshot into a DayFlow CalendarApp.
 *
 * Computes the diff between the incoming snapshot and the current app state,
 * then applies adds, updates, and deletes with `source: 'remote'` to prevent
 * write-back loops.
 */
export declare function applyRemoteSnapshot(
  app: ICalendarApp,
  snapshot: {
    events: Event[];
    calendars: CalendarType[];
  },
  options: RemoteSnapshotOptions
): Promise<RemoteSnapshotDelta>;
