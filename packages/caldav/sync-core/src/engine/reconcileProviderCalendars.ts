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

function defaultAreCalendarsEqual<CalendarRecord>(
  next: CalendarRecord,
  existing: CalendarRecord
) {
  const nextEntries = Object.entries(next as Record<string, unknown>);
  const existingRecord = existing as Record<string, unknown>;
  return nextEntries.every(([key, value]) => existingRecord[key] === value);
}

/**
 * Reconcile a provider calendar list against local calendar records.
 *
 * The helper is storage-neutral: callers decide how records are saved or
 * deactivated. It returns normalized changes that applications can optionally
 * consume for audit/history features without making history part of sync-core.
 */
export async function reconcileProviderCalendars<
  RemoteCalendar,
  CalendarRecord,
>(
  options: ReconcileProviderCalendarsOptions<RemoteCalendar, CalendarRecord>
): Promise<ReconcileProviderCalendarsResult<CalendarRecord>> {
  const areEqual = options.areEqual ?? defaultAreCalendarsEqual;
  const existingByExternalId = new Map(
    options.existingCalendars.map(calendar => [
      options.getRecordExternalCalendarId(calendar),
      calendar,
    ])
  );

  const remoteCalendarIds = new Set(
    options.remoteCalendars.map(options.getRemoteCalendarId)
  );
  const nextRecords = options.remoteCalendars.map(remote =>
    options.mapRemoteCalendar(
      remote,
      existingByExternalId.get(options.getRemoteCalendarId(remote))
    )
  );
  const recordsToSave = nextRecords.filter(record => {
    const existing = existingByExternalId.get(
      options.getRecordExternalCalendarId(record)
    );
    return !existing || !areEqual(record, existing);
  });
  const recordsToDeactivate = options.existingCalendars.filter(
    record =>
      !remoteCalendarIds.has(options.getRecordExternalCalendarId(record))
  );

  const changes: Array<SyncCalendarChange<CalendarRecord>> = [];
  for (const record of recordsToSave) {
    const existing = existingByExternalId.get(
      options.getRecordExternalCalendarId(record)
    );
    changes.push({
      type: existing ? 'calendar.updated' : 'calendar.created',
      provider: options.provider,
      before: existing ?? null,
      after: record,
    });
  }
  for (const record of recordsToDeactivate) {
    changes.push({
      type: 'calendar.removed',
      provider: options.provider,
      before: record,
      after: null,
    });
  }

  if (recordsToSave.length === 0 && recordsToDeactivate.length === 0) {
    return {
      records: options.existingCalendars,
      changed: false,
      changes,
    };
  }

  const [savedRecords, deactivatedRecords] = await Promise.all([
    recordsToSave.length > 0
      ? options.save(recordsToSave)
      : Promise.resolve([] as CalendarRecord[]),
    recordsToDeactivate.length > 0
      ? options.deactivate(recordsToDeactivate)
      : Promise.resolve([] as CalendarRecord[]),
  ]);

  const nextById = new Map(
    options.existingCalendars.map(record => [
      options.getRecordId(record),
      record,
    ])
  );
  for (const record of savedRecords) {
    nextById.set(options.getRecordId(record), record);
  }
  for (const record of deactivatedRecords) {
    nextById.set(options.getRecordId(record), record);
  }

  return {
    records: Array.from(nextById.values()),
    changed: true,
    changes,
  };
}
