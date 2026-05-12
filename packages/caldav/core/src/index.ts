/**
 * Headless, adapter-first CalDAV sync engine for DayFlow.
 *
 * This package provides:
 * - Stable public types for CalDAV adapters, calendars, events, storage, and transport
 * - iCalendar ↔ DayFlow event mapping (Phase 3)
 * - (Phase 4+) Default CalDAV protocol adapter
 * - (Phase 5+) Sync engine and DayFlow binding
 *
 * What this package does NOT provide:
 * - Login forms or OAuth flows
 * - Credential storage
 * - Hosted sync service
 *
 * Authentication and transport are fully controlled by the application.
 */

// Public types
export type {
  CalDAVAdapter,
  CalDAVCalendar,
  CalDAVDeletedEvent,
  CalDAVEventData,
  CalDAVEventSyncState,
  CalDAVRemoteRef,
  CalDAVStorage,
  CalDAVSyncResult,
  CalDAVTransport,
  CalDAVWriteResult,
} from './types';

// iCalendar mapping
export {
  createNamespacedCalDAVEventId,
  getCalDAVMeta,
  mapCalDAVEventToDayFlow,
  mapDayFlowEventToCalDAV,
} from './mapper';
export type {
  CalDAVEventIdInput,
  CalDAVEventMapperOptions,
  CalDAVEventMeta,
} from './mapper';

// CalDAV protocol adapter
export {
  createCalDAVAdapter,
  createCalDAVAdapterFromServer,
  CalDAVError,
  discoverCalendarHome,
  ICLOUD_CALDAV_SERVER,
  nextcloudConfig,
  radicaleConfig,
  fastmailConfig,
  type CalDAVAdapterOptions,
  type CalDAVErrorCode,
} from './adapter';

// iCalendar RRULE utilities
export {
  parseRRule,
  expandRRule,
  type ParsedRRule,
  type RRuleFreq,
} from './ics/rrule';
export { parseICalendar, parseICalDate } from './ics/parse';
export type {
  ParsedVEvent,
  ICalProperty,
  ICalPropertyParams,
} from './ics/types';

// Sync engine + DayFlow binding
export {
  createCalDAVSync,
  createMemoryCalDAVStorage,
  attachCalDAVToDayFlow,
  applyRemoteSnapshot,
  mapCalDAVCalendarToDayFlow,
  type CalDAVSync,
  type CalDAVDayFlowController,
  type CalDAVDayFlowOptions,
  type CalDAVSyncStatus,
  type CalDAVSyncDelta,
  type CalDAVErrorContext,
  type RemoteSnapshotOptions,
  type RemoteSnapshotDelta,
} from './sync';
