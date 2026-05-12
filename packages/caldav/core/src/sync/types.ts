import type { CalDAVEventMapperOptions } from '@caldav/mapper/toEvent';
import type { CalDAVCalendar } from '@caldav/types/calendar';
import type {
  CalDAVRemoteRef,
  CalDAVSyncResult,
  CalDAVWriteResult,
} from '@caldav/types/event';
import type { CalendarType, Event } from '@dayflow/core';

// ─── Headless sync engine ────────────────────────────────────────────────────

/**
 * Headless CalDAV sync engine — no DayFlow dependency.
 *
 * Wraps the protocol adapter and manages etag/sync-token storage so callers
 * never have to handle those details directly.
 */
export interface CalDAVSync {
  listCalendars(): Promise<CalDAVCalendar[]>;
  syncEvents(input: {
    calendarId: string;
    range?: { start: Date; end: Date };
  }): Promise<CalDAVSyncResult>;
  createEvent(input: {
    calendarId: string;
    event: Event;
  }): Promise<CalDAVWriteResult>;
  updateEvent(input: {
    calendarId: string;
    event: Event;
    remote: CalDAVRemoteRef;
  }): Promise<CalDAVWriteResult>;
  deleteEvent(input: {
    calendarId: string;
    remote: CalDAVRemoteRef;
  }): Promise<void>;
}

// ─── DayFlow binding ─────────────────────────────────────────────────────────

export type CalDAVSyncStatus = {
  state: 'idle' | 'syncing' | 'error';
  lastSyncedAt?: Date;
  error?: unknown;
};

export type CalDAVSyncDelta = {
  calendars: { added: number; updated: number; deleted: number };
  events: { added: number; updated: number; deleted: number };
};

export interface CalDAVDayFlowController {
  /** Discover remote calendars, load initial events, and subscribe to changes. */
  start(): Promise<void>;
  /** Unsubscribe all listeners. Does not clear DayFlow state. */
  stop(): void;
  /**
   * Re-sync a specific calendar or all calendars.
   * If `range` is omitted, uses the last known visible range.
   */
  refresh(input?: {
    calendarId?: string;
    range?: { start: Date; end: Date };
  }): Promise<void>;
  getStatus(): CalDAVSyncStatus;
}

export type CalDAVDayFlowOptions = {
  /**
   * Allow local DayFlow event mutations to be written back to the CalDAV server.
   * Default: true. Set to false for a read-only integration.
   */
  writable?: boolean;

  /**
   * Automatically re-sync events when the user navigates to a new date range.
   * Default: true.
   */
  refreshOnVisibleRangeChange?: boolean;

  eventMode?: {
    /**
     * How recurring events are treated. Only 'read-only' is supported in MVP.
     * Default: 'read-only'.
     */
    recurring?: 'read-only';
  };

  /** Called when any sync or write operation fails. */
  onError?: (error: unknown, context: CalDAVErrorContext) => void;

  /**
   * Seed DayFlow with locally-cached data before the first remote sync.
   *
   * Called once during `start()`, before any CalDAV requests are made.
   * Use this to hydrate from IndexedDB, Supabase, or any local store so
   * the calendar renders immediately while the background sync runs.
   *
   * Errors from this callback are passed to `onError` and do not abort
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
  onSyncComplete?: (delta: CalDAVSyncDelta) => void;

  /**
   * Called after a local event mutation is successfully written back to the
   * CalDAV server. Use this to update a local persistence layer with the
   * server-assigned href/etag without maintaining a separate event listener.
   */
  onWriteComplete?: (
    operation: 'create' | 'update' | 'delete',
    event: Event
  ) => void;

  /**
   * Build the DayFlow event id for remote CalDAV events.
   *
   * The DayFlow binding defaults to a provider-scoped id to avoid collisions
   * with local events or other providers. Pass a custom factory if your app has
   * an existing id strategy.
   */
  createEventId?: CalDAVEventMapperOptions['createEventId'];
};

export type CalDAVErrorContext = {
  operation:
    | 'list-calendars'
    | 'initial-sync'
    | 'range-sync'
    | 'create'
    | 'update'
    | 'delete';
  calendarId?: string;
  eventId?: string;
};
