export {
  createOutlookSync,
  type OutlookSync,
  type OutlookSyncRange,
  type OutlookSyncResult,
} from './createOutlookSync';

export {
  attachOutlookSyncToDayFlow,
  type OutlookDayFlowController,
} from './attachOutlookSyncToDayFlow';

export {
  createOutlookSyncAdapter,
  OutlookSyncError,
  type OutlookSyncAdapterOptions,
} from './createOutlookSyncAdapter';

export { applyRemoteSnapshot } from './applyRemoteSnapshot';
export type {
  RemoteSnapshotDelta,
  RemoteSnapshotOptions,
} from './applyRemoteSnapshot';
