import { reconcileProviderEvents } from '../engine/reconcileProviderEvents';

type RemoteEvent = { id: string; title: string };
type DeletedRemoteEvent = { id: string };
type EventRecord = {
  id: string;
  externalEventId: string | null;
  title: string;
  deletedAt: string | null;
};

function mapRemoteEvent(
  remote: RemoteEvent,
  existing?: EventRecord
): EventRecord {
  return {
    id: existing?.id ?? `local-${remote.id}`,
    externalEventId: remote.id,
    title: remote.title,
    deletedAt: null,
  };
}

describe('reconcileProviderEvents', () => {
  it('imports, updates, and reports provider-neutral changes without owning history', async () => {
    const existing: EventRecord[] = [
      {
        id: 'local-ev-1',
        externalEventId: 'ev-1',
        title: 'Old title',
        deletedAt: null,
      },
    ];

    const result = await reconcileProviderEvents<
      RemoteEvent,
      DeletedRemoteEvent,
      EventRecord,
      EventRecord
    >({
      provider: 'test',
      calendarId: 'cal-1',
      remoteEvents: [
        { id: 'ev-1', title: 'New title' },
        { id: 'ev-2', title: 'Fresh event' },
      ],
      existingRecords: existing,
      getRemoteEventId: remote => remote.id,
      getDeletedRemoteEventId: deleted => deleted.id,
      getRecordExternalEventId: record => record.externalEventId,
      isRecordDeleted: record => record.deletedAt !== null,
      mapRemoteEvent,
      save: records => records,
      softDelete: jest.fn(),
    });

    expect(result.imported).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.changes.map(change => change.type)).toEqual([
      'event.updated',
      'event.imported',
    ]);
    expect(result.changes[0]).toEqual(
      expect.objectContaining({
        before: existing[0],
        after: expect.objectContaining({ title: 'New title' }),
      })
    );
  });

  it('soft-deletes existing remote deletions through the supplied callback', async () => {
    const existing: EventRecord[] = [
      {
        id: 'local-ev-1',
        externalEventId: 'ev-1',
        title: 'Remote deleted',
        deletedAt: null,
      },
      {
        id: 'local-ev-2',
        externalEventId: 'ev-2',
        title: 'Already deleted',
        deletedAt: '2026-01-01T00:00:00Z',
      },
    ];
    const softDelete = jest.fn(() => ({
      deletedAt: '2026-02-01T00:00:00Z',
    }));

    const result = await reconcileProviderEvents<
      RemoteEvent,
      DeletedRemoteEvent,
      EventRecord,
      EventRecord
    >({
      provider: 'test',
      calendarId: 'cal-1',
      remoteEvents: [],
      deletedRemoteEvents: [{ id: 'ev-1' }, { id: 'ev-2' }, { id: 'missing' }],
      existingRecords: existing,
      getRemoteEventId: remote => remote.id,
      getDeletedRemoteEventId: deleted => deleted.id,
      getRecordExternalEventId: record => record.externalEventId,
      isRecordDeleted: record => record.deletedAt !== null,
      mapRemoteEvent,
      save: jest.fn(),
      softDelete,
    });

    expect(result.deleted).toBe(1);
    expect(softDelete).toHaveBeenCalledTimes(1);
    expect(softDelete).toHaveBeenCalledWith(existing[0], { id: 'ev-1' });
    expect(result.changes).toEqual([
      expect.objectContaining({
        type: 'event.deleted',
        before: existing[0],
        after: null,
        deletedAt: '2026-02-01T00:00:00Z',
      }),
    ]);
  });
});
