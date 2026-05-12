import type { CalendarType, Event } from '@dayflow/core';
import {
  mapGoogleEventToDayFlow,
  mapDayFlowEventToGoogle,
  mapGoogleCalendarToDayFlow,
} from '@google-sync/mapper';
import type { GoogleSyncAdapter } from '@google-sync/types/adapter';
import type { GoogleCalendarEvent } from '@google-sync/types/api';
import { getGoogleMeta } from '@google-sync/types/meta';
import type { GoogleSyncStorage } from '@google-sync/types/storage';

import { GoogleSyncError } from './createGoogleSyncAdapter';

export type GoogleSyncRange = {
  start: string; // RFC 3339
  end: string; // RFC 3339
};

export type GoogleSyncResult = {
  events: Event[];
  deleted: string[]; // DayFlow event IDs
  syncToken?: string;
};

export type GoogleSync = {
  /**
   * List all calendars the authenticated user has access to.
   */
  listCalendars(): Promise<CalendarType[]>;

  /**
   * Fetch events for the given calendar and date range.
   * If syncToken is provided, performs incremental sync.
   */
  syncEvents(
    calendarId: string,
    range?: GoogleSyncRange,
    syncToken?: string
  ): Promise<GoogleSyncResult>;

  /** Create a new event on Google Calendar. Returns the created event with server-assigned id/etag. */
  createEvent(calendarId: string, event: Event): Promise<Event>;

  /** Update an existing event. Requires event.meta.google.etag for conflict detection. */
  updateEvent(event: Event): Promise<Event>;

  /** Delete an event by its DayFlow id. Requires event.meta.google for the Google id/etag. */
  deleteEvent(event: Event): Promise<void>;
};

function remapWithMeta(
  googleEvent: GoogleCalendarEvent,
  calendarId: string
): Event | null {
  return mapGoogleEventToDayFlow(googleEvent, calendarId);
}

export function createGoogleSync(
  adapter: GoogleSyncAdapter,
  options?: { storage?: GoogleSyncStorage }
): GoogleSync {
  const storage = options?.storage;

  return {
    async listCalendars(): Promise<CalendarType[]> {
      const list = await adapter.listCalendars();
      return list.items.filter(e => !e.hidden).map(mapGoogleCalendarToDayFlow);
    },

    async syncEvents(calendarId, range, syncToken): Promise<GoogleSyncResult> {
      // Explicit syncToken takes priority; fall back to stored token for
      // incremental sync when no range is requested (full-calendar refresh).
      let effectiveToken =
        syncToken ??
        (range ? null : ((await storage?.getSyncToken(calendarId)) ?? null));

      const events: Event[] = [];
      const deleted: string[] = [];
      let token: string | undefined;
      let pageToken: string | undefined;
      let retriedExpiredToken = false;

      while (true) {
        let result;
        try {
          result = await adapter.listEvents(calendarId, {
            ...(effectiveToken
              ? { syncToken: effectiveToken, showDeleted: true }
              : {
                  timeMin: range?.start,
                  timeMax: range?.end,
                  singleEvents: true,
                }),
            pageToken,
          });
        } catch (err) {
          if (
            err instanceof GoogleSyncError &&
            err.statusCode === 410 &&
            effectiveToken &&
            !retriedExpiredToken
          ) {
            await storage?.setSyncToken(calendarId, null);
            effectiveToken = null;
            pageToken = undefined;
            token = undefined;
            events.length = 0;
            deleted.length = 0;
            retriedExpiredToken = true;
            continue;
          }
          throw err;
        }

        for (const item of result.items) {
          if (item.status === 'cancelled') {
            // Incremental sync: cancelled = deleted
            deleted.push(item.id);
          } else {
            const mapped = mapGoogleEventToDayFlow(item, calendarId);
            if (mapped) events.push(mapped);
          }
        }

        token = result.nextSyncToken;
        pageToken = result.nextPageToken;
        if (!pageToken) break;
      }

      if (token && storage) {
        await storage.setSyncToken(calendarId, token);
      }

      return { events, deleted, syncToken: token };
    },

    async createEvent(calendarId, event): Promise<Event> {
      const input = mapDayFlowEventToGoogle(event);
      const created = await adapter.createEvent(calendarId, input);
      return remapWithMeta(created, calendarId) ?? event;
    },

    async updateEvent(event): Promise<Event> {
      const meta = getGoogleMeta(event);
      if (!meta) throw new Error('Event missing google meta — cannot update');
      const input = mapDayFlowEventToGoogle(event);
      try {
        const updated = await adapter.updateEvent(
          meta.calendarId,
          meta.eventId,
          input,
          meta.etag
        );
        return remapWithMeta(updated, meta.calendarId) ?? event;
      } catch (err) {
        if (!(err instanceof GoogleSyncError) || err.statusCode !== 412)
          throw err;
        // Stale etag — re-fetch to get the latest etag and retry once
        const fresh = await adapter.getEvent(meta.calendarId, meta.eventId);
        const updated = await adapter.updateEvent(
          meta.calendarId,
          meta.eventId,
          input,
          fresh.etag
        );
        return remapWithMeta(updated, meta.calendarId) ?? event;
      }
    },

    async deleteEvent(event): Promise<void> {
      const meta = getGoogleMeta(event);
      if (!meta) throw new Error('Event missing google meta — cannot delete');
      try {
        await adapter.deleteEvent(meta.calendarId, meta.eventId, meta.etag);
      } catch (err) {
        if (!(err instanceof GoogleSyncError) || err.statusCode !== 412)
          throw err;
        // Stale etag — retry without etag (DELETE is idempotent, conflict irrelevant)
        await adapter.deleteEvent(meta.calendarId, meta.eventId);
      }
    },
  };
}
