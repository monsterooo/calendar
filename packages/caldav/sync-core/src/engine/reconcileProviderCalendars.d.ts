import type { SyncCalendarChange } from '../types/change';
export type ReconcileProviderCalendarsResult<CalendarRecord> = {
  records: CalendarRecord[];
  changed: boolean;
  changes: Array<SyncCalendarChange<CalendarRecord>>;
};
export type ReconcileProviderCalendarsOptions<RemoteCalendar, CalendarRecord> =
  {
    provider: string;
    remoteCalendars: RemoteCalendar[];
    existingCalendars: CalendarRecord[];
    getRemoteCalendarId(remote: RemoteCalendar): string;
    getRecordId(record: CalendarRecord): string;
    getRecordExternalCalendarId(record: CalendarRecord): string;
    mapRemoteCalendar(
      remote: RemoteCalendar,
      existing: CalendarRecord | undefined
    ): CalendarRecord;
    areEqual?(next: CalendarRecord, existing: CalendarRecord): boolean;
    save(
      records: CalendarRecord[]
    ): Promise<CalendarRecord[]> | CalendarRecord[];
    deactivate(
      records: CalendarRecord[]
    ): Promise<CalendarRecord[]> | CalendarRecord[];
  };
/**
 * Reconcile a provider calendar list against local calendar records.
 *
 * The helper is storage-neutral: callers decide how records are saved or
 * deactivated. It returns normalized changes that applications can optionally
 * consume for audit/history features without making history part of sync-core.
 */
export declare function reconcileProviderCalendars<
  RemoteCalendar,
  CalendarRecord,
>(
  options: ReconcileProviderCalendarsOptions<RemoteCalendar, CalendarRecord>
): Promise<ReconcileProviderCalendarsResult<CalendarRecord>>;
