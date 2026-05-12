import type { CalendarType, Event } from '@dayflow/core';

import type {
  OutlookCalendarList,
  OutlookEvent,
  OutlookEventInput,
  OutlookEventList,
  OutlookListEventsOptions,
} from './api';

/**
 * Transport-agnostic adapter interface for the Microsoft Graph Calendar API.
 *
 * Authentication is fully external — supply an authenticated `fetch` or use
 * the `getToken` option on `createOutlookSyncAdapter`.
 */
export interface OutlookSyncAdapter {
  /** GET /me/calendars */
  listCalendars(): Promise<OutlookCalendarList>;

  /**
   * GET /me/calendars/{calendarId}/calendarView (range query)
   * GET /me/calendars/{calendarId}/calendarView/delta (incremental, via deltaLink)
   *
   * Pass `deltaLink` in options for incremental sync; pass `startDateTime`/`endDateTime`
   * for a range query.
   */
  listEvents(
    calendarId: string,
    options: OutlookListEventsOptions
  ): Promise<OutlookEventList>;

  /** GET /me/calendars/{calendarId}/events/{eventId} */
  getEvent(calendarId: string, eventId: string): Promise<OutlookEvent>;

  /** POST /me/calendars/{calendarId}/events */
  createEvent(
    calendarId: string,
    event: OutlookEventInput
  ): Promise<OutlookEvent>;

  /**
   * PATCH /me/calendars/{calendarId}/events/{eventId}
   * Uses `If-Match: <etag>` for optimistic concurrency control.
   */
  updateEvent(
    calendarId: string,
    eventId: string,
    event: Partial<OutlookEventInput>,
    etag: string
  ): Promise<OutlookEvent>;

  /**
   * DELETE /me/calendars/{calendarId}/events/{eventId}
   * 404 is treated as success (already deleted).
   */
  deleteEvent(
    calendarId: string,
    eventId: string,
    etag?: string
  ): Promise<void>;
}

export type OutlookSyncStatus = {
  state: 'idle' | 'syncing' | 'error';
  lastSyncedAt?: string; // ISO timestamp
  error?: { message: string; calendarId?: string };
};

export type OutlookSyncDelta = {
  calendars: { added: number; updated: number; deleted: number };
  events: { added: number; updated: number; deleted: number };
};

export type OutlookDayFlowOptions = {
  /**
   * Allow local DayFlow mutations to write back to Outlook Calendar.
   * Default: true. Set false for read-only mirrors.
   */
  writable?: boolean;

  /** Called whenever the sync state changes. */
  onStatusChange?: (status: OutlookSyncStatus) => void;

  /**
   * Called when a write-back to Outlook Calendar fails.
   * Default: log to console.error.
   */
  onWriteError?: (
    err: Error,
    context: { action: 'create' | 'update' | 'delete'; eventId?: string }
  ) => void;

  /**
   * Seed DayFlow with locally-cached data before the first remote sync.
   *
   * Called once during `start()`, before any Graph API requests.
   * Use this to hydrate from IndexedDB, a database, or any local store so
   * the calendar renders immediately while the background sync runs.
   */
  getInitialSnapshot?: () => Promise<{
    events: Event[];
    calendars: CalendarType[];
  }>;

  /**
   * Called after each successful sync (initial, range-change, or manual refresh)
   * with counts of what changed. Use this to update your local store without
   * re-diffing the entire event set.
   */
  onSyncComplete?: (delta: OutlookSyncDelta) => void;

  /**
   * Called after a local mutation is successfully written back to Outlook Calendar.
   * Use this to persist server-assigned IDs and ETags to your local store.
   */
  onWriteComplete?: (
    operation: 'create' | 'update' | 'delete',
    event: Event
  ) => void;
};
