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
} from './api';

export type { OutlookEventMeta } from './meta';
export { getOutlookMeta } from './meta';

export type { OutlookSyncStorage } from './storage';

export type {
  OutlookSyncAdapter,
  OutlookSyncStatus,
  OutlookSyncDelta,
  OutlookDayFlowOptions,
} from './adapter';
