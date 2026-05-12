import { createOutlookSync } from '@outlook-sync/sync/createOutlookSync';
import { OutlookSyncError } from '@outlook-sync/sync/createOutlookSyncAdapter';
import type { OutlookSyncAdapter } from '@outlook-sync/types/adapter';
import type {
  OutlookCalendarList,
  OutlookEvent,
  OutlookEventList,
} from '@outlook-sync/types/api';
import type { OutlookSyncStorage } from '@outlook-sync/types/storage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOutlookEvent(
  id: string,
  overrides: Partial<OutlookEvent> = {}
): OutlookEvent {
  return {
    id,
    subject: `Event ${id}`,
    start: { dateTime: '2025-06-15T10:00:00', timeZone: 'UTC' },
    end: { dateTime: '2025-06-15T11:00:00', timeZone: 'UTC' },
    isAllDay: false,
    isCancelled: false,
    isOrganizer: true,
    type: 'singleInstance',
    changeKey: 'ck',
    '@odata.etag': `W/"etag-${id}"`,
    ...overrides,
  };
}

function makeAdapter(
  overrides: Partial<OutlookSyncAdapter> = {}
): jest.Mocked<OutlookSyncAdapter> {
  return {
    listCalendars: jest.fn().mockResolvedValue({
      value: [
        {
          id: 'cal-1',
          name: 'Work',
          color: 'lightBlue',
          isDefaultCalendar: true,
          canEdit: true,
          canShare: false,
          canViewPrivateItems: true,
        },
      ],
    } satisfies OutlookCalendarList),
    listEvents: jest.fn().mockResolvedValue({
      value: [makeOutlookEvent('evt-1')],
      '@odata.deltaLink':
        'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=TOKEN123',
    } satisfies OutlookEventList),
    getEvent: jest.fn(),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn().mockImplementation(() => Promise.resolve()),
    ...overrides,
  } as jest.Mocked<OutlookSyncAdapter>;
}

function makeStorage(
  initial: Record<string, string | null> = {}
): OutlookSyncStorage {
  const store = { ...initial };
  return {
    getDeltaToken: jest.fn((id: string) => Promise.resolve(store[id] ?? null)),
    setDeltaToken: jest.fn((id: string, token: string | null) => {
      store[id] = token;
      return Promise.resolve();
    }),
  };
}

// ─── listCalendars ────────────────────────────────────────────────────────────

describe('createOutlookSync.listCalendars', () => {
  it('returns mapped CalendarType array', async () => {
    const sync = createOutlookSync(makeAdapter());
    const calendars = await sync.listCalendars();
    expect(calendars).toHaveLength(1);
    expect(calendars[0].id).toBe('cal-1');
    expect(calendars[0].source).toBe('Outlook');
    expect(calendars[0].readOnly).toBe(false);
  });
});

// ─── syncEvents ───────────────────────────────────────────────────────────────

describe('createOutlookSync.syncEvents', () => {
  it('calls listEvents with range when no delta token exists', async () => {
    const adapter = makeAdapter();
    const sync = createOutlookSync(adapter);
    const range = {
      start: '2025-01-01T00:00:00Z',
      end: '2025-12-31T23:59:59Z',
    };

    await sync.syncEvents('cal-1', range);

    expect(adapter.listEvents).toHaveBeenCalledWith('cal-1', {
      deltaLink: undefined,
      startDateTime: range.start,
      endDateTime: range.end,
    });
  });

  it('uses stored delta token when no range is provided', async () => {
    const adapter = makeAdapter();
    const storage = makeStorage({
      'cal-1': 'https://graph.microsoft.com/delta?tok=OLD',
    });
    const sync = createOutlookSync(adapter, { storage });

    await sync.syncEvents('cal-1');

    expect(adapter.listEvents).toHaveBeenCalledWith('cal-1', {
      deltaLink: 'https://graph.microsoft.com/delta?tok=OLD',
      startDateTime: undefined,
      endDateTime: undefined,
    });
  });

  it('persists delta token from response into storage', async () => {
    const adapter = makeAdapter();
    const storage = makeStorage();
    const sync = createOutlookSync(adapter, { storage });

    const result = await sync.syncEvents('cal-1', {
      start: '2025-01-01T00:00:00Z',
      end: '2025-12-31T23:59:59Z',
    });

    expect(result.deltaToken).toBe(
      'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=TOKEN123'
    );
    expect(storage.setDeltaToken).toHaveBeenCalledWith(
      'cal-1',
      expect.stringContaining('TOKEN123')
    );
  });

  it('returns mapped events', async () => {
    const sync = createOutlookSync(makeAdapter());
    const result = await sync.syncEvents('cal-1', {
      start: '2025-01-01T00:00:00Z',
      end: '2025-12-31T23:59:59Z',
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('evt-1');
    expect(result.deleted).toHaveLength(0);
  });

  it('treats @removed items as deletions', async () => {
    const adapter = makeAdapter({
      listEvents: jest.fn().mockResolvedValue({
        value: [
          makeOutlookEvent('evt-kept'),
          { id: 'evt-deleted', '@removed': { reason: 'deleted' } },
          { id: 'evt-changed', '@removed': { reason: 'changed' } },
        ],
      } satisfies OutlookEventList),
    });
    const sync = createOutlookSync(adapter);
    const result = await sync.syncEvents('cal-1', {
      start: '2025-01-01T00:00:00Z',
      end: '2025-12-31T23:59:59Z',
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('evt-kept');
    expect(result.deleted).toEqual(['evt-deleted', 'evt-changed']);
  });

  it('does NOT treat isCancelled events as deletions', async () => {
    const adapter = makeAdapter({
      listEvents: jest.fn().mockResolvedValue({
        value: [makeOutlookEvent('evt-cancelled', { isCancelled: true })],
      } satisfies OutlookEventList),
    });
    const sync = createOutlookSync(adapter);
    const result = await sync.syncEvents('cal-1', {
      start: '2025-01-01T00:00:00Z',
      end: '2025-12-31T23:59:59Z',
    });

    // Cancelled events are filtered by the mapper (returns null), not treated as deletions
    expect(result.events).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });

  it('recovers from 410 expired delta token', async () => {
    const storage = makeStorage({
      'cal-1': 'https://graph.microsoft.com/delta?tok=EXPIRED',
    });
    const adapter = makeAdapter();

    adapter.listEvents
      .mockRejectedValueOnce(new OutlookSyncError(410, 'Delta token expired'))
      .mockResolvedValueOnce({
        value: [makeOutlookEvent('evt-fresh')],
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?tok=FRESH',
      } satisfies OutlookEventList);

    const sync = createOutlookSync(adapter, { storage });

    const result = await sync.syncEvents('cal-1');

    expect(adapter.listEvents).toHaveBeenCalledTimes(2);
    // Storage token cleared on 410
    expect(storage.setDeltaToken).toHaveBeenCalledWith('cal-1', null);
    // Fresh events from fallback query
    expect(result.events[0].id).toBe('evt-fresh');
    // New delta token persisted
    expect(storage.setDeltaToken).toHaveBeenCalledWith(
      'cal-1',
      expect.stringContaining('FRESH')
    );
  });

  it('re-throws non-410 errors', async () => {
    const adapter = makeAdapter({
      listEvents: jest
        .fn()
        .mockRejectedValue(new OutlookSyncError(503, 'Service unavailable')),
    });
    const sync = createOutlookSync(adapter);

    await expect(
      sync.syncEvents('cal-1', {
        start: '2025-01-01T00:00:00Z',
        end: '2025-12-31T23:59:59Z',
      })
    ).rejects.toThrow(OutlookSyncError);
  });
});

// ─── createEvent ─────────────────────────────────────────────────────────────

describe('createOutlookSync.createEvent', () => {
  it('creates event and returns mapped result', async () => {
    const created = makeOutlookEvent('evt-server-id');
    const adapter = makeAdapter({
      createEvent: jest.fn().mockResolvedValue(created),
    });
    const sync = createOutlookSync(adapter);

    const event = {
      id: 'local-id',
      title: 'New Meeting',
      start: { year: 2025, month: 6, day: 15 } as never,
      end: { year: 2025, month: 6, day: 15 } as never,
      calendarId: 'cal-1',
    };

    const result = await sync.createEvent('cal-1', event as never);

    expect(adapter.createEvent).toHaveBeenCalledWith(
      'cal-1',
      expect.any(Object)
    );
    // Result has server-assigned ID
    expect(result.id).toBe('evt-server-id');
  });
});

// ─── updateEvent ─────────────────────────────────────────────────────────────

describe('createOutlookSync.updateEvent', () => {
  function makeEventWithMeta(overrides: Partial<OutlookEvent> = {}) {
    const base = makeOutlookEvent('evt-1', overrides);
    const mapped = {
      id: 'evt-1',
      title: 'Updated Title',
      start: {} as never,
      end: {} as never,
      calendarId: 'cal-1',
      meta: {
        outlook: {
          eventId: 'evt-1',
          calendarId: 'cal-1',
          etag: 'W/"etag-evt-1"',
          isRecurring: false,
        },
      },
    };
    return { base, mapped };
  }

  it('calls updateEvent with correct etag', async () => {
    const { base, mapped } = makeEventWithMeta();
    const adapter = makeAdapter({
      updateEvent: jest.fn().mockResolvedValue(base),
    });
    const sync = createOutlookSync(adapter);

    await sync.updateEvent(mapped as never);

    expect(adapter.updateEvent).toHaveBeenCalledWith(
      'cal-1',
      'evt-1',
      expect.any(Object),
      'W/"etag-evt-1"'
    );
  });

  it('retries with fresh etag on 412', async () => {
    const { base, mapped } = makeEventWithMeta();
    const freshEtag = 'W/"fresh-etag"';
    const freshEvent = { ...base, '@odata.etag': freshEtag };

    const adapter = makeAdapter();
    adapter.getEvent.mockResolvedValue(freshEvent);
    adapter.updateEvent
      .mockRejectedValueOnce(new OutlookSyncError(412, 'Precondition Failed'))
      .mockResolvedValueOnce(freshEvent);

    const sync = createOutlookSync(adapter);

    await sync.updateEvent(mapped as never);

    expect(adapter.getEvent).toHaveBeenCalledWith('cal-1', 'evt-1');
    expect(adapter.updateEvent).toHaveBeenCalledTimes(2);
    expect(adapter.updateEvent).toHaveBeenLastCalledWith(
      'cal-1',
      'evt-1',
      expect.any(Object),
      freshEtag
    );
  });

  it('throws if event has no outlook meta', async () => {
    const sync = createOutlookSync(makeAdapter());
    await expect(
      sync.updateEvent({ id: 'x', title: 'x', meta: {} } as never)
    ).rejects.toThrow('missing outlook meta');
  });
});

// ─── deleteEvent ─────────────────────────────────────────────────────────────

describe('createOutlookSync.deleteEvent', () => {
  const eventWithMeta = {
    id: 'evt-1',
    title: 'To Delete',
    start: {} as never,
    end: {} as never,
    calendarId: 'cal-1',
    meta: {
      outlook: {
        eventId: 'evt-1',
        calendarId: 'cal-1',
        etag: 'W/"etag-1"',
        isRecurring: false,
      },
    },
  };

  it('deletes with etag', async () => {
    const adapter = makeAdapter();
    const sync = createOutlookSync(adapter);
    await sync.deleteEvent(eventWithMeta as never);
    expect(adapter.deleteEvent).toHaveBeenCalledWith(
      'cal-1',
      'evt-1',
      'W/"etag-1"'
    );
  });

  it('retries without etag on 412', async () => {
    const adapter = makeAdapter();
    adapter.deleteEvent
      .mockRejectedValueOnce(new OutlookSyncError(412, 'Precondition Failed'))
      .mockImplementationOnce(() => Promise.resolve());

    const sync = createOutlookSync(adapter);
    await sync.deleteEvent(eventWithMeta as never);
    expect(adapter.deleteEvent).toHaveBeenCalledTimes(2);
    // Second call has no etag argument (idempotent delete)
    expect(adapter.deleteEvent).toHaveBeenLastCalledWith('cal-1', 'evt-1');
  });

  it('throws if event has no outlook meta', async () => {
    const sync = createOutlookSync(makeAdapter());
    await expect(
      sync.deleteEvent({ id: 'x', meta: {} } as never)
    ).rejects.toThrow('missing outlook meta');
  });
});
