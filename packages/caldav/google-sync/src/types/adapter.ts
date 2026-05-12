import type { CalendarType, Event } from '@dayflow/core';

import type {
  GoogleCalendarList,
  GoogleCalendarEvent,
  GoogleEventInput,
  GoogleEventList,
  GoogleListEventsOptions,
} from './api';

/**
 * Transport-agnostic adapter interface for the Google Calendar REST API v3.
 *
 * Callers inject this via `createGoogleSync({ adapter })`.
 * The adapter implementation owns authentication — the sync engine never
 * sees credentials directly.
 *
 * Usage with a backend proxy:
 *   createGoogleSyncAdapter({ fetch: proxiedFetch })
 */
export interface GoogleSyncAdapter {
  /** GET /calendar/v3/users/me/calendarList */
  listCalendars(): Promise<GoogleCalendarList>;

  /**
   * GET /calendar/v3/calendars/{calendarId}/events
   * Pass timeMin/timeMax for range queries, syncToken for incremental sync.
   */
  listEvents(
    calendarId: string,
    options: GoogleListEventsOptions
  ): Promise<GoogleEventList>;

  /** GET /calendar/v3/calendars/{calendarId}/events/{eventId} */
  getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent>;

  /** POST /calendar/v3/calendars/{calendarId}/events */
  createEvent(
    calendarId: string,
    event: GoogleEventInput
  ): Promise<GoogleCalendarEvent>;

  /** POST /calendar/v3/calendars/{calendarId}/events/{eventId}/move */
  moveEvent(
    calendarId: string,
    eventId: string,
    destinationCalendarId: string
  ): Promise<GoogleCalendarEvent>;

  /**
   * PUT /calendar/v3/calendars/{calendarId}/events/{eventId}
   * etag is sent as `If-Match` for optimistic conflict detection.
   */
  updateEvent(
    calendarId: string,
    eventId: string,
    event: GoogleEventInput,
    etag: string
  ): Promise<GoogleCalendarEvent>;

  /**
   * DELETE /calendar/v3/calendars/{calendarId}/events/{eventId}
   * 404 is treated as success (already deleted).
   */
  deleteEvent(
    calendarId: string,
    eventId: string,
    etag?: string
  ): Promise<void>;
}

export type GoogleSyncStatus = {
  state: 'idle' | 'syncing' | 'error';
  lastSyncedAt?: string;
  error?: { message: string; calendarId?: string };
};

export type GoogleSyncDelta = {
  calendars: { added: number; updated: number; deleted: number };
  events: { added: number; updated: number; deleted: number };
};

export type GoogleDayFlowOptions = {
  /**
   * Allow local DayFlow mutations to write back to Google Calendar.
   * Default: true. Set false for connection tests or read-only mirrors.
   */
  writable?: boolean;

  /**
   * Fired when a write-back to Google Calendar fails.
   * Default: log to console.error.
   */
  onWriteError?: (
    err: Error,
    context: { action: 'create' | 'update' | 'delete'; eventId?: string }
  ) => void;

  /**
   * Fired when the sync state changes.
   */
  onStatusChange?: (status: GoogleSyncStatus) => void;

  /**
   * Seed DayFlow with locally-cached data before the first remote sync.
   *
   * Called once during `start()`, before any Google Calendar API requests.
   * Use this to hydrate from IndexedDB, Supabase, or any local store so
   * the calendar renders immediately while the background sync runs.
   *
   * Errors from this callback are passed to `onWriteError` and do not abort
   * the remote sync.
   */
  getInitialSnapshot?: () => Promise<{
    events: Event[];
    calendars: CalendarType[];
  }>;

  /**
   * Called after each successful sync (initial, range-change, or manual refresh).
   * Provides a count of what changed so callers can update their own stores
   * without re-diffing the entire event set.
   */
  onSyncComplete?: (delta: GoogleSyncDelta) => void;

  /**
   * Called after a local event mutation is successfully written back to
   * Google Calendar. Use this to update a local persistence layer with the
   * server-assigned id/etag without maintaining a separate event listener.
   */
  onWriteComplete?: (
    operation: 'create' | 'update' | 'delete',
    event: Event
  ) => void;
};
