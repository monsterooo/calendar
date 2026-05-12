/**
 * Headless, adapter-first Microsoft Outlook Calendar sync engine for DayFlow.
 *
 * This package provides:
 * - Type-safe Microsoft Graph Calendar API types
 * - Calendar and event mappers (Outlook Calendar ↔ DayFlow)
 * - Transport-agnostic sync engine (OutlookSync) with delta-token support
 * - DayFlow binding with write-back, incremental sync, and observability hooks
 * - Default HTTP adapter (createOutlookSyncAdapter) with `getToken` factory
 *
 * What this package does NOT provide:
 * - OAuth flows or MSAL token management
 * - Credential storage
 * - Hosted sync service
 *
 * Authentication and transport are fully controlled by the application.
 *
 * Quick start:
 * ```ts
 * const adapter = createOutlookSyncAdapter({ getToken: () => getAccessToken() });
 * const sync = createOutlookSync(adapter);
 * const controller = attachOutlookSyncToDayFlow(app, sync);
 * await controller.start();
 * ```
 */

// Public types
export type {
  OutlookCalendar,
  OutlookCalendarColor,
  OutlookCalendarList,
  OutlookDateTimeValue,
  OutlookDeletedItem,
  OutlookEvent,
  OutlookEventInput,
  OutlookEventList,
  OutlookEventListItem,
  OutlookEventType,
  OutlookListEventsOptions,
} from './types/api';

export type { OutlookEventMeta } from './types/meta';
export { getOutlookMeta } from './types/meta';

export type { OutlookSyncStorage } from './types/storage';

export type {
  OutlookSyncAdapter,
  OutlookSyncStatus,
  OutlookSyncDelta,
  OutlookDayFlowOptions,
} from './types/adapter';

// Mappers
export {
  mapOutlookEventToDayFlow,
  mapDayFlowEventToOutlook,
  mapOutlookCalendarToDayFlow,
} from './mapper';

// Sync engine + DayFlow binding
export {
  createOutlookSync,
  type OutlookSync,
  type OutlookSyncRange,
  type OutlookSyncResult,
} from './sync/createOutlookSync';

export {
  attachOutlookSyncToDayFlow,
  type OutlookDayFlowController,
} from './sync/attachOutlookSyncToDayFlow';

export {
  createOutlookSyncAdapter,
  OutlookSyncError,
  type OutlookSyncAdapterOptions,
} from './sync/createOutlookSyncAdapter';

export { applyRemoteSnapshot } from './sync/applyRemoteSnapshot';
export type {
  RemoteSnapshotDelta,
  RemoteSnapshotOptions,
} from './sync/applyRemoteSnapshot';
