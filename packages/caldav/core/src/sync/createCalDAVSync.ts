import { getCalDAVMeta } from '@caldav/mapper';
import type { CalDAVAdapter } from '@caldav/types/adapter';
import type { CalDAVCalendar } from '@caldav/types/calendar';
import type {
  CalDAVRemoteRef,
  CalDAVSyncResult,
  CalDAVWriteResult,
} from '@caldav/types/event';
import type { CalDAVStorage } from '@caldav/types/storage';
import type { Event } from '@dayflow/core';

import { createMemoryCalDAVStorage } from './memoryStorage';
import type { CalDAVSync, CalDAVSyncOptions } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function splitRange(
  range: { start: Date; end: Date },
  chunkDays: number
): Array<{ start: Date; end: Date }> {
  if (!Number.isFinite(chunkDays) || chunkDays <= 0) return [range];

  const chunks: Array<{ start: Date; end: Date }> = [];
  let start = new Date(range.start);
  const end = new Date(range.end);
  const chunkMs = chunkDays * MS_PER_DAY;

  while (start < end) {
    const next = new Date(Math.min(start.getTime() + chunkMs, end.getTime()));
    chunks.push({ start, end: next });
    start = next;
  }

  return chunks.length > 0 ? chunks : [range];
}

async function syncRangeInChunks(
  adapter: CalDAVAdapter,
  calendarId: string,
  range: { start: Date; end: Date },
  rangeChunkDays: number | undefined
): Promise<CalDAVSyncResult> {
  const chunks = splitRange(range, rangeChunkDays ?? 0);
  if (chunks.length === 1) {
    return adapter.syncEvents({ calendarId, range });
  }

  const byHref = new Map<string, CalDAVSyncResult['events'][number]>();
  for (const chunk of chunks) {
    const result = await adapter.syncEvents({ calendarId, range: chunk });
    for (const event of result.events) {
      byHref.set(event.href, event);
    }
  }

  return { events: Array.from(byHref.values()), deleted: [] };
}

/**
 * Create a headless CalDAV sync engine.
 *
 * This layer wraps the protocol adapter and handles etag/sync-token storage
 * so callers never have to manage those details. It has no dependency on DayFlow.
 */
export function createCalDAVSync({
  adapter,
  storage = createMemoryCalDAVStorage(),
  rangeChunkDays,
}: {
  adapter: CalDAVAdapter;
  storage?: CalDAVStorage;
} & CalDAVSyncOptions): CalDAVSync {
  const calendarCtags = new Map<string, string>();

  async function listCalendars(): Promise<CalDAVCalendar[]> {
    const calendars = await adapter.listCalendars();
    for (const calendar of calendars) {
      if (calendar.ctag) {
        calendarCtags.set(calendar.id, calendar.ctag);
      }
    }
    return calendars;
  }

  return {
    listCalendars,

    async syncEvents({ calendarId, range }) {
      const knownCtag = calendarCtags.get(calendarId);
      const storedCtag = await storage.getCtag(calendarId);
      if (!range && knownCtag !== undefined && storedCtag === knownCtag) {
        return { events: [], deleted: [] };
      }

      // Use stored sync tokens only for collection-wide sync. Visible-range
      // loading still needs a range REPORT so unchanged events in a newly
      // visible range are not skipped.
      const storedToken = range ? null : await storage.getSyncToken(calendarId);
      const result = range
        ? await syncRangeInChunks(adapter, calendarId, range, rangeChunkDays)
        : await adapter.syncEvents({
            calendarId,
            syncToken: storedToken ?? undefined,
          });

      // Persist new sync token for the next incremental call
      if (result.syncToken) {
        await storage.setSyncToken(calendarId, result.syncToken);
      } else if (storedToken) {
        await storage.setSyncToken(calendarId, null);
      }
      if (knownCtag) {
        await storage.setCtag(calendarId, knownCtag);
      }

      await Promise.all([
        ...result.events.map(async event => {
          if (event.etag) {
            await storage.setEtag(event.href, event.etag);
          }
          await storage.setEventState(event.uid, {
            calendarId: event.calendarId,
            uid: event.uid,
            href: event.href,
            etag: event.etag,
            lastSyncedAt: new Date().toISOString(),
          });
        }),
        ...result.deleted.map(async event => {
          await storage.deleteEtag(event.href);
          if (event.uid) {
            await storage.deleteEventState(event.uid);
          }
        }),
      ]);

      return result;
    },

    async createEvent({
      calendarId,
      event,
    }: {
      calendarId: string;
      event: Event;
    }): Promise<CalDAVWriteResult> {
      const result = await adapter.createEvent({ calendarId, event });
      // Persist the server-assigned etag for use in future conditional requests
      if (result.etag) {
        await storage.setEtag(result.href, result.etag);
      }
      const meta = getCalDAVMeta(event);
      const uid = meta?.uid ?? event.id;
      await storage.setEventState(event.id, {
        calendarId,
        uid,
        href: result.href,
        etag: result.etag,
        lastSyncedAt: new Date().toISOString(),
      });
      return result;
    },

    async updateEvent({
      calendarId,
      event,
      remote,
    }: {
      calendarId: string;
      event: Event;
      remote: CalDAVRemoteRef;
    }): Promise<CalDAVWriteResult> {
      const result = await adapter.updateEvent({ calendarId, event, remote });
      if (result.etag) {
        await storage.setEtag(result.href, result.etag);
      }
      await storage.setEventState(event.id, {
        calendarId,
        uid: remote.uid,
        href: result.href,
        etag: result.etag,
        lastSyncedAt: new Date().toISOString(),
      });
      return result;
    },

    async deleteEvent({
      calendarId,
      remote,
    }: {
      calendarId: string;
      remote: CalDAVRemoteRef;
    }): Promise<void> {
      await adapter.deleteEvent({ calendarId, remote });
      await storage.deleteEtag(remote.href);
      await storage.deleteEventState(remote.uid);
    },
  };
}
