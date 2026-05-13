# @dayflow/caldav

Open-source, headless, adapter-first CalDAV sync infrastructure for DayFlow.

This package is intentionally not a login UI, OAuth flow, credential store, or hosted sync service. Applications provide their own authentication, transport, backend proxy, storage, and sync policy.

## Design Boundary

```txt
DayFlow core:
  UI, views, interaction, event/calendar state

@dayflow/caldav:
  CalDAV protocol adapter, iCalendar mapping, sync storage bookkeeping,
  and an optional DayFlow attachment controller

User application:
  auth, tokens, backend proxy, encrypted secrets, offline policy,
  conflict workflow, and provider-specific business rules
```

## Quick Start

```ts
import {
  attachCalDAVToDayFlow,
  createCalDAVAdapter,
  createCalDAVSync,
  createNamespacedCalDAVEventId,
  mapCalDAVEventToDayFlow,
} from '@dayflow/caldav';

const adapter = createCalDAVAdapter({
  calendarHomeUrl: '/calendars/alice/',
  fetch: (url, init) =>
    fetch('/api/caldav-proxy', {
      method: 'POST',
      body: JSON.stringify({ url, init }),
    }),
});

const sync = createCalDAVSync({
  adapter,
  storage,
  // Optional: split broad visible-range REPORTs into smaller windows.
  rangeChunkDays: 31,
});

const controller = attachCalDAVToDayFlow(calendar.app, sync, {
  writable: true,
  refreshOnVisibleRangeChange: true,
  maxConcurrentCalendars: 4,
  createEventId: createNamespacedCalDAVEventId,
  eventMode: {
    recurring: 'read-only',
  },
});

await controller.start();
```

DayFlow never sees credentials. The application controls the transport.

## Provider Helpers

Provider helpers return configuration only. They do not own credentials.

```ts
import {
  ICLOUD_CALDAV_SERVER,
  discoverCalendarHome,
  nextcloudConfig,
  radicaleConfig,
  fastmailConfig,
} from '@dayflow/caldav';
```

For iCloud, discover the calendar home URL through authenticated backend/proxy fetch:

```ts
const calendarHomeUrl = await discoverCalendarHome(
  ICLOUD_CALDAV_SERVER,
  proxiedFetch
);

const adapter = createCalDAVAdapter({
  calendarHomeUrl,
  fetch: proxiedFetch,
});
```

Compatibility notes:

- iCloud requires an app-specific password and a backend proxy in browser apps.
- Nextcloud commonly returns 8-digit RGBA calendar colors; alpha is stripped.
- Radicale may omit permission metadata; ambiguous permissions default to read-only.
- Fastmail should be integrated through user-controlled transport just like other providers.

## API Reference

### createCalDAVAdapter(options)

Creates the default CalDAV protocol adapter.

Options:

- `calendarHomeUrl`: authenticated user's CalDAV calendar home collection.
- `fetch`: user-injected request function, usually backed by a backend proxy.

The adapter performs `PROPFIND`, `REPORT`, `PUT`, and `DELETE`. It does not accept `username`, `password`, OAuth tokens, or cookies directly.

### createCalDAVSync(options)

Creates the headless sync engine around an adapter and storage implementation.

Options:

- `adapter`: a `CalDAVAdapter`.
- `storage`: a `CalDAVStorage`.
- `rangeChunkDays`: optional day window size for broad visible-range syncs.

The sync engine stores etags, event sync state, sync tokens, and calendar ctags. It does not own `start`, `stop`, app subscriptions, UI state, or credentials.

### attachCalDAVToDayFlow(app, sync, options)

Attaches a headless sync engine to a DayFlow `CalendarApp`.

Options:

- `writable`: allow eligible local changes to write back to CalDAV.
- `refreshOnVisibleRangeChange`: sync when the user navigates to a new range.
- `maxConcurrentCalendars`: number of remote calendars to sync in parallel.
- `eventMode.recurring`: currently `read-only`.
- `onError`: receives sync/write errors with operation context.
- `createEventId`: build DayFlow ids for remote CalDAV events. The binding
  defaults to provider-scoped ids via `createNamespacedCalDAVEventId`.

The controller registers remote calendars, applies remote events with `source: 'remote'`, observes local event changes, and writes eligible non-recurring changes back through the sync engine.

Direct mapper calls keep the historical UID-as-id default for compatibility:

```ts
const event = mapCalDAVEventToDayFlow(data, {
  createEventId: createNamespacedCalDAVEventId,
});
```

### CalDAVStorage

Applications provide durable storage for sync bookkeeping. If no storage is
provided, `createCalDAVSync` uses an in-memory adapter intended for tests and
quick starts only; production apps should persist this state in IndexedDB,
localStorage, or a server-side store.

```ts
interface CalDAVStorage {
  getSyncToken(calendarId: string): Promise<string | null>;
  setSyncToken(calendarId: string, token: string | null): Promise<void>;
  getCtag(calendarId: string): Promise<string | null>;
  setCtag(calendarId: string, ctag: string): Promise<void>;
  getEtag(href: string): Promise<string | null>;
  setEtag(href: string, etag: string): Promise<void>;
  deleteEtag(href: string): Promise<void>;
  getEventState(eventId: string): Promise<CalDAVEventSyncState | null>;
  setEventState(eventId: string, state: CalDAVEventSyncState): Promise<void>;
  deleteEventState(eventId: string): Promise<void>;
  clearCalendar(calendarId: string): Promise<void>;
}
```

Storage should contain sync metadata only. Do not store credentials here.

## Snapshot Safety

`applyRemoteSnapshot` treats snapshots as partial by default, so missing local
records are preserved unless you explicitly opt into deletion. Use
`snapshotMode: 'authoritative'` only when the snapshot fully represents all
provider-owned calendars and events:

```ts
await applyRemoteSnapshot(app, fullProviderSnapshot, {
  isOwnedEvent,
  isOwnedCalendar,
  snapshotMode: 'authoritative',
});
```

For visible-range, filtered, or paginated responses, keep the default partial
mode or pass `deleteMissingEvents: false` / `deleteMissingCalendars: false`.

## Current Limits

- Recurring events are detected and treated as read-only for write-back.
- RRULE expansion utilities support basic `DAILY`, `WEEKLY`, `MONTHLY`, and `YEARLY` rules plus `RDATE`/`EXDATE` include/exclude dates, but recurrence exception editing is not supported yet.
- `sync-token` support is collection-wide. Visible-range loading uses range queries so unchanged events in newly visible ranges are not skipped.
- Calendar `ctag` values are used as a safe collection-wide no-op optimization when available.
