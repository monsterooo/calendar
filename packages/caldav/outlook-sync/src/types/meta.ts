import type { Event } from '@dayflow/core';

export type OutlookEventMeta = {
  /** Microsoft Graph event ID. */
  eventId: string;
  /** ID of the calendar this event belongs to. */
  calendarId: string;
  /** OData ETag for conditional update/delete (`If-Match` header). */
  etag: string;
  /** True if this is a recurring event master or occurrence. */
  isRecurring: boolean;
};

/**
 * Extract Outlook-specific metadata from a DayFlow Event.
 * Returns null if the event is not backed by an Outlook calendar.
 */
export function getOutlookMeta(event: Event): OutlookEventMeta | null {
  const meta = event.meta?.outlook as OutlookEventMeta | undefined;
  if (!meta?.eventId || !meta?.calendarId || !meta?.etag) return null;
  return meta;
}
