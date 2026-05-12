import {
  createOutlookSyncAdapter,
  OutlookSyncError,
} from '@outlook-sync/sync/createOutlookSyncAdapter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFetch(
  responses: Array<{
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
  }>
) {
  let idx = 0;
  return jest.fn().mockImplementation(() => {
    const resp = responses[idx++] ?? responses.at(-1);
    return Promise.resolve({
      status: resp.status,
      ok: resp.status >= 200 && resp.status < 300,
      json: () => Promise.resolve(resp.body),
      text: () => Promise.resolve(JSON.stringify(resp.body ?? '')),
      headers: {
        get: (name: string) => resp.headers?.[name.toLowerCase()] ?? null,
      },
    });
  });
}

const CALENDARS_RESPONSE = {
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
};

const EVENTS_RESPONSE = {
  value: [
    {
      id: 'evt-1',
      subject: 'Meeting',
      start: { dateTime: '2025-06-15T10:00:00', timeZone: 'UTC' },
      end: { dateTime: '2025-06-15T11:00:00', timeZone: 'UTC' },
      isAllDay: false,
      isCancelled: false,
      isOrganizer: true,
      type: 'singleInstance',
      changeKey: 'ck',
      '@odata.etag': 'W/"etag1"',
    },
  ],
  '@odata.deltaLink':
    'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=T1',
};

// ─── getToken injection ───────────────────────────────────────────────────────

describe('createOutlookSyncAdapter getToken', () => {
  it('injects Authorization header from synchronous getToken', async () => {
    const fetch = makeFetch([{ status: 200, body: CALENDARS_RESPONSE }]);
    const adapter = createOutlookSyncAdapter({
      fetch,
      getToken: () => 'my-access-token',
    });

    await adapter.listCalendars();

    const [, init] = fetch.mock.calls[0];
    expect(init.headers?.['Authorization']).toBe('Bearer my-access-token');
  });

  it('injects Authorization header from async getToken', async () => {
    const fetch = makeFetch([{ status: 200, body: CALENDARS_RESPONSE }]);
    const adapter = createOutlookSyncAdapter({
      fetch,
      getToken: () => Promise.resolve('async-token'),
    });

    await adapter.listCalendars();

    const [, init] = fetch.mock.calls[0];
    expect(init.headers?.['Authorization']).toBe('Bearer async-token');
  });

  it('calls getToken fresh on each request', async () => {
    let callCount = 0;
    const fetch = makeFetch([
      { status: 200, body: CALENDARS_RESPONSE },
      { status: 200, body: CALENDARS_RESPONSE },
    ]);
    const adapter = createOutlookSyncAdapter({
      fetch,
      getToken: () => {
        callCount++;
        return `token-${callCount}`;
      },
    });

    await adapter.listCalendars();
    await adapter.listCalendars();

    expect(callCount).toBe(2);
    expect(fetch.mock.calls[0][1].headers?.['Authorization']).toBe(
      'Bearer token-1'
    );
    expect(fetch.mock.calls[1][1].headers?.['Authorization']).toBe(
      'Bearer token-2'
    );
  });
});

// ─── 429 retry ───────────────────────────────────────────────────────────────

describe('createOutlookSyncAdapter 429 handling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries once after 429 with Retry-After seconds', async () => {
    const fetch = makeFetch([
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 200, body: CALENDARS_RESPONSE },
    ]);
    const adapter = createOutlookSyncAdapter({ fetch });

    const promise = adapter.listCalendars();
    await jest.advanceTimersByTimeAsync(1100);
    const result = await promise;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.value).toHaveLength(1);
  });

  it('throws if second attempt also fails', async () => {
    const fetch = makeFetch([
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 429, headers: { 'retry-after': '1' } },
    ]);
    const adapter = createOutlookSyncAdapter({ fetch });

    await Promise.all([
      expect(adapter.listCalendars()).rejects.toBeInstanceOf(OutlookSyncError),
      jest.runAllTimersAsync(),
    ]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('createOutlookSyncAdapter error handling', () => {
  it('throws OutlookSyncError with status code on non-2xx', async () => {
    const fetch = makeFetch([
      { status: 401, body: { error: { code: 'Unauthorized' } } },
    ]);
    const adapter = createOutlookSyncAdapter({ fetch });

    let error: OutlookSyncError | undefined;
    try {
      await adapter.listCalendars();
    } catch (err) {
      error = err as OutlookSyncError;
    }

    expect(error).toBeInstanceOf(OutlookSyncError);
    expect(error?.statusCode).toBe(401);
  });

  it('treats 404 as success for deleteEvent', async () => {
    const fetch = makeFetch([{ status: 404, body: { error: 'not found' } }]);
    const adapter = createOutlookSyncAdapter({ fetch });

    await expect(
      adapter.deleteEvent('cal-1', 'evt-1')
    ).resolves.toBeUndefined();
  });

  it('treats 204 as success with undefined body', async () => {
    const fetch = makeFetch([{ status: 204 }]);
    const adapter = createOutlookSyncAdapter({ fetch });

    const result = await adapter.deleteEvent('cal-1', 'evt-1');
    expect(result).toBeUndefined();
  });
});

// ─── Pagination ───────────────────────────────────────────────────────────────

describe('createOutlookSyncAdapter pagination', () => {
  it('follows @odata.nextLink for listCalendars', async () => {
    const page1 = {
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
      '@odata.nextLink':
        'https://graph.microsoft.com/v1.0/me/calendars?$skip=1',
    };
    const page2 = {
      value: [
        {
          id: 'cal-2',
          name: 'Personal',
          color: 'lightGreen',
          isDefaultCalendar: false,
          canEdit: true,
          canShare: false,
          canViewPrivateItems: true,
        },
      ],
    };
    const fetch = makeFetch([
      { status: 200, body: page1 },
      { status: 200, body: page2 },
    ]);
    const adapter = createOutlookSyncAdapter({ fetch });

    const result = await adapter.listCalendars();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe(page1['@odata.nextLink']);
    expect(result.value).toHaveLength(2);
    expect(result.value.map(c => c.id)).toEqual(['cal-1', 'cal-2']);
  });

  it('follows @odata.nextLink for listEvents and preserves deltaLink from last page', async () => {
    const page1 = {
      value: [{ id: 'evt-1' }],
      '@odata.nextLink':
        'https://graph.microsoft.com/v1.0/me/calendarView/delta?$skip=1',
    };
    const page2 = {
      value: [{ id: 'evt-2' }],
      '@odata.deltaLink':
        'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=FINAL',
    };
    const fetch = makeFetch([
      { status: 200, body: page1 },
      { status: 200, body: page2 },
    ]);
    const adapter = createOutlookSyncAdapter({ fetch });

    const result = await adapter.listEvents('cal-1', {
      startDateTime: '2025-01-01T00:00:00Z',
      endDateTime: '2025-12-31T23:59:59Z',
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.value).toHaveLength(2);
    expect(result['@odata.deltaLink']).toContain('FINAL');
  });
});

// ─── listEvents URL construction ──────────────────────────────────────────────

describe('createOutlookSyncAdapter listEvents', () => {
  it('uses calendarView/delta with startDateTime/endDateTime for range queries', async () => {
    const fetch = makeFetch([{ status: 200, body: EVENTS_RESPONSE }]);
    const adapter = createOutlookSyncAdapter({ fetch });

    await adapter.listEvents('cal-1', {
      startDateTime: '2025-01-01T00:00:00Z',
      endDateTime: '2025-12-31T23:59:59Z',
    });

    const [url] = fetch.mock.calls[0];
    expect(url).toContain('calendarView/delta');
    expect(url).toContain('startDateTime=2025-01-01T00%3A00%3A00Z');
    expect(url).toContain('endDateTime=2025-12-31T23%3A59%3A59Z');
  });

  it('uses deltaLink directly for incremental sync', async () => {
    const deltaLink =
      'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=OLD';
    const fetch = makeFetch([{ status: 200, body: EVENTS_RESPONSE }]);
    const adapter = createOutlookSyncAdapter({ fetch });

    await adapter.listEvents('cal-1', { deltaLink });

    const [url] = fetch.mock.calls[0];
    expect(url).toBe(deltaLink);
  });
});
