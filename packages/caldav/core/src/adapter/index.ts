export {
  createCalDAVAdapter,
  type CalDAVAdapterOptions,
} from './createCalDAVAdapter';
export { CalDAVError, type CalDAVErrorCode } from './errors';
export {
  discoverCalendarHome,
  createCalDAVAdapterFromServer,
} from './discover';
export {
  ICLOUD_CALDAV_SERVER,
  nextcloudConfig,
  radicaleConfig,
  fastmailConfig,
} from './presets';
