import type { CalendarType, Event } from '@dayflow/core';
import {
  mapDayFlowEventToOutlook,
  mapOutlookCalendarToDayFlow,
  mapOutlookEventToDayFlow,
} from '@outlook-sync/mapper';
import type { OutlookSyncAdapter } from '@outlook-sync/types/adapter';
import type {
  OutlookEvent,
  OutlookEventListItem,
} from '@outlook-sync/types/api';
import { getOutlookMeta } from '@outlook-sync/types/meta';
import type { OutlookSyncStorage } from '@outlook-sync/types/storage';

import { OutlookSyncError } from './createOutlookSyncAdapter';

function isDeletedItem(
  item: OutlookEventListItem
): item is { id: string; '@removed': { reason: 'deleted' | 'changed' } } {
  return '@removed' in item;
}

export type OutlookSyncRange = {
  start: string; // ISO 8601
  end: string; // ISO 8601
};

export type OutlookSyncResult = {
  events: Event[];
  /** DayFlow event IDs that were deleted on the server. */
  deleted: string[];
  /** Persist this delta token to enable incremental sync on next call. */
  deltaToken?: string;
};

export type OutlookSync = {
  /** List all calendars the authenticated user has access to. */
  listCalendars(): Promise<CalendarType[]>;

  /**
   * Fetch events for a calendar.
   *
   * - Provide `range` for a full range query (e.g. on first load).
   * - Provide `deltaToken` for incremental sync (only changed events returned).
   * - If `storage` was passed to `createOutlookSync`, the delta token is
   *   automatically persisted and retrieved — you can omit `deltaToken`.
   */
  syncEvents(
    calendarId: string,
    range?: OutlookSyncRange,
    deltaToken?: string
  ): Promise<OutlookSyncResult>;

  /** Create a new event. Returns the created event with server-assigned id/etag. */
  createEvent(calendarId: string, event: Event): Promise<Event>;

  /** Update an existing event. Requires event.meta.outlook.etag for conflict detection. */
  updateEvent(event: Event): Promise<Event>;

  /** Delete an event. Requires event.meta.outlook.eventId and etag. */
  deleteEvent(event: Event): Promise<void>;
};

function remapWithMeta(
  outlookEvent: OutlookEvent,
  calendarId: string
): Event | null {
  return mapOutlookEventToDayFlow(outlookEvent, calendarId);
}

/** Extract the raw delta token value from a full @odata.deltaLink URL. */
function extractDeltaToken(deltaLink: string): string {
  // The deltaLink IS the URL to follow on next sync — store it directly
  // rather than extracting a token, since the full URL encodes the query window
  return deltaLink;
}

export function createOutlookSync(
  adapter: OutlookSyncAdapter,
  options?: { storage?: OutlookSyncStorage }
): OutlookSync {
  const storage = options?.storage;

  return {
    async listCalendars(): Promise<CalendarType[]> {
      const list = await adapter.listCalendars();
      return list.value.map(mapOutlookCalendarToDayFlow);
    },

    async syncEvents(
      calendarId,
      range,
      explicitDeltaToken
    ): Promise<OutlookSyncResult> {
      // Priority: explicit token > stored token > full range query
      const storedToken = range
        ? null
        : ((await storage?.getDeltaToken(calendarId)) ?? null);
      const deltaLink = explicitDeltaToken ?? storedToken ?? undefined;

      const events: Event[] = [];
      const deleted: string[] = [];

      let result;
      try {
        result = await adapter.listEvents(calendarId, {
          deltaLink,
          startDateTime: deltaLink ? undefined : range?.start,
          endDateTime: deltaLink ? undefined : range?.end,
        });
      } catch (err) {
        // 410 Gone: delta token expired. Clear the stored token and retry
        // with a full range query so the next sync starts fresh.
        if (
          err instanceof OutlookSyncError &&
          err.statusCode === 410 &&
          deltaLink &&
          storage
        ) {
          await storage.setDeltaToken(calendarId, null);
          result = await adapter.listEvents(calendarId, {
            startDateTime: range?.start,
            endDateTime: range?.end,
          });
        } else {
          throw err;
        }
      }

      for (const item of result.value) {
        if (isDeletedItem(item)) {
          // Only treat `deleted` reason as a hard delete in DayFlow.
          // `changed` means the event moved outside the calendarView window
          // and should be removed from the current range view as well.
          deleted.push(item.id);
        } else {
          const mapped = mapOutlookEventToDayFlow(item, calendarId);
          if (mapped) events.push(mapped);
        }
      }

      const rawDeltaLink = result['@odata.deltaLink'];
      const deltaToken = rawDeltaLink
        ? extractDeltaToken(rawDeltaLink)
        : undefined;

      if (deltaToken && storage) {
        await storage.setDeltaToken(calendarId, deltaToken);
      }

      return { events, deleted, deltaToken };
    },

    async createEvent(calendarId, event): Promise<Event> {
      const input = mapDayFlowEventToOutlook(event);
      const created = await adapter.createEvent(calendarId, input);
      return remapWithMeta(created, calendarId) ?? event;
    },

    async updateEvent(event): Promise<Event> {
      const meta = getOutlookMeta(event);
      if (!meta) throw new Error('Event missing outlook meta — cannot update');

      const input = mapDayFlowEventToOutlook(event);
      try {
        const updated = await adapter.updateEvent(
          meta.calendarId,
          meta.eventId,
          input,
          meta.etag
        );
        return remapWithMeta(updated, meta.calendarId) ?? event;
      } catch (err) {
        if (!(err instanceof OutlookSyncError) || err.statusCode !== 412)
          throw err;
        // Stale ETag (412 Precondition Failed) — re-fetch and retry once
        const fresh = await adapter.getEvent(meta.calendarId, meta.eventId);
        const updated = await adapter.updateEvent(
          meta.calendarId,
          meta.eventId,
          input,
          fresh['@odata.etag']
        );
        return remapWithMeta(updated, meta.calendarId) ?? event;
      }
    },

    async deleteEvent(event): Promise<void> {
      const meta = getOutlookMeta(event);
      if (!meta) throw new Error('Event missing outlook meta — cannot delete');
      try {
        await adapter.deleteEvent(meta.calendarId, meta.eventId, meta.etag);
      } catch (err) {
        if (!(err instanceof OutlookSyncError) || err.statusCode !== 412)
          throw err;
        // Stale ETag — retry without etag (DELETE is idempotent)
        await adapter.deleteEvent(meta.calendarId, meta.eventId);
      }
    },
  };
}
