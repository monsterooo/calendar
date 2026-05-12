export type SyncCalendarStatus = 'idle' | 'syncing' | 'error';

export type SyncEventStatus =
  | 'synced'
  | 'local_pending'
  | 'remote_deleted'
  | 'conflict'
  | 'sync_error';

export interface SyncCalendarRecord {
  id: string;
  userId?: string;
  accountId: string;
  provider: string;
  externalCalendarId: string;
  name: string;
  color: string | null;
  readOnly: boolean;
  syncEnabled: boolean;
  syncToken: string | null;
  syncStatus: SyncCalendarStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface SyncEventRecord<RawRemoteEvent = unknown> {
  id: string;
  userId?: string;
  accountId: string;
  calendarId: string;
  provider: string;
  externalEventId: string | null;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string | null;
  allDay: boolean;
  location: string | null;
  rawData: RawRemoteEvent | null;
  externalUpdatedAt: string | null;
  localUpdatedAt: string | null;
  syncStatus: SyncEventStatus;
  deletedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type SyncEventRecordInput<RawRemoteEvent = unknown> = Omit<
  SyncEventRecord<RawRemoteEvent>,
  'createdAt' | 'updatedAt'
>;
