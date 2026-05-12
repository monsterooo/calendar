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
    | Promise<
        | {
            deletedAt?: string | null;
          }
        | null
        | undefined
      >
    | {
        deletedAt?: string | null;
      }
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
export declare function reconcileProviderEvents<
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
): Promise<ReconcileProviderEventsResult<EventRecord>>;
