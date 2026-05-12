import type { SyncCalendarRecord, SyncEventRecord } from './records';

export type SyncWriteOperation = 'create' | 'update' | 'move' | 'delete';

export type SyncChangeType =
  | 'calendar.created'
  | 'calendar.updated'
  | 'calendar.removed'
  | 'event.imported'
  | 'event.updated'
  | 'event.deleted'
  | 'event.created'
  | 'event.moved'
  | 'event.write_failed';

export type SyncCalendarChange<CalendarRecord = SyncCalendarRecord> = {
  type: 'calendar.created' | 'calendar.updated' | 'calendar.removed';
  provider: string;
  before: CalendarRecord | null;
  after: CalendarRecord | null;
};

export type SyncEventChange<
  EventRecord = SyncEventRecord,
  RawRemoteEvent = unknown,
> = {
  type:
    | 'event.imported'
    | 'event.updated'
    | 'event.deleted'
    | 'event.created'
    | 'event.moved'
    | 'event.write_failed';
  provider: string;
  calendarId: string;
  before: EventRecord | null;
  after: EventRecord | null;
  raw?: RawRemoteEvent;
  error?: unknown;
  deletedAt?: string | null;
};

export type SyncChange<
  CalendarRecord = SyncCalendarRecord,
  EventRecord = SyncEventRecord,
  RawRemoteEvent = unknown,
> =
  | SyncCalendarChange<CalendarRecord>
  | SyncEventChange<EventRecord, RawRemoteEvent>;
