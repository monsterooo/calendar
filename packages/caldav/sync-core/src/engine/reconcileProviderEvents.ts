import type { SyncEventChange } from '../types/change';

export type ReconcileProviderEventsResult<EventRecord> = {
  imported: number;
  updated: number;
  deleted: number;
  savedRecords: EventRecord[];
  changes: Array<SyncEventChange<EventRecord>>;
};

export type ReconcileProviderEventsOptions<
  RemoteEvent,
  DeletedRemoteEvent,
  EventRecord,
  EventRecordInput,
> = {
  provider: string;
  calendarId: string;
  remoteEvents: RemoteEvent[];
  deletedRemoteEvents?: DeletedRemoteEvent[];
  existingRecords: EventRecord[];
  getRemoteEventId(remote: RemoteEvent): string;
  getDeletedRemoteEventId(deleted: DeletedRemoteEvent): string | null;
  getRecordExternalEventId(
    record: EventRecord | EventRecordInput
  ): string | null;
  isRecordDeleted?(record: EventRecord): boolean;
  mapRemoteEvent(
    remote: RemoteEvent,
    existing: EventRecord | undefined
  ): EventRecordInput | null;
  save(records: EventRecordInput[]): Promise<EventRecord[]> | EventRecord[];
  softDelete(
    record: EventRecord,
    deleted: DeletedRemoteEvent
  ):
    | Promise<{ deletedAt?: string | null } | null | undefined>
    | { deletedAt?: string | null }
    | null
    | undefined;
};

/**
 * Reconcile remote provider events into local event records.
 *
 * This helper owns only the provider-neutral diff/apply loop. It does not write
 * audit history or assume a database schema; callers convert the returned
 * `changes` into product-specific history if they need that feature.
 */
export async function reconcileProviderEvents<
  RemoteEvent,
  DeletedRemoteEvent,
  EventRecord,
  EventRecordInput,
>(
  options: ReconcileProviderEventsOptions<
    RemoteEvent,
    DeletedRemoteEvent,
    EventRecord,
    EventRecordInput
  >
): Promise<ReconcileProviderEventsResult<EventRecord>> {
  const existingByExternalId = new Map(
    options.existingRecords
      .map(
        record => [options.getRecordExternalEventId(record), record] as const
      )
      .filter(
        (entry): entry is readonly [string, EventRecord] => entry[0] !== null
      )
  );

  const inputs = options.remoteEvents
    .map(remote =>
      options.mapRemoteEvent(
        remote,
        existingByExternalId.get(options.getRemoteEventId(remote))
      )
    )
    .filter((record): record is EventRecordInput => record !== null);
  const savedRecords = inputs.length > 0 ? await options.save(inputs) : [];

  let imported = 0;
  let updated = 0;
  let deleted = 0;
  const changes: Array<SyncEventChange<EventRecord>> = [];

  for (const saved of savedRecords) {
    const externalEventId = options.getRecordExternalEventId(saved);
    const existing = externalEventId
      ? existingByExternalId.get(externalEventId)
      : undefined;
    const wasDeleted = existing ? options.isRecordDeleted?.(existing) : false;
    const type = !existing || wasDeleted ? 'event.imported' : 'event.updated';

    if (type === 'event.imported') {
      imported += 1;
    } else {
      updated += 1;
    }

    changes.push({
      type,
      provider: options.provider,
      calendarId: options.calendarId,
      before: existing ?? null,
      after: saved,
    });
  }

  for (const deletedRemote of options.deletedRemoteEvents ?? []) {
    const externalEventId = options.getDeletedRemoteEventId(deletedRemote);
    const existing = externalEventId
      ? existingByExternalId.get(externalEventId)
      : undefined;
    if (!existing || options.isRecordDeleted?.(existing)) {
      continue;
    }

    const result = await options.softDelete(existing, deletedRemote);
    deleted += 1;
    changes.push({
      type: 'event.deleted',
      provider: options.provider,
      calendarId: options.calendarId,
      before: existing,
      after: null,
      raw: deletedRemote,
      deletedAt: result?.deletedAt ?? null,
    });
  }

  return {
    imported,
    updated,
    deleted,
    savedRecords,
    changes,
  };
}
