/**
 * Minimal sync-state persistence interface for Outlook Calendar sync.
 *
 * Stores delta tokens so that after the initial sync, subsequent syncs are
 * incremental — only changed events are fetched rather than the full range.
 *
 * ```ts
 * const storage: OutlookSyncStorage = {
 *   getDeltaToken: async (id) => localStorage.getItem(`outlook-delta:${id}`),
 *   setDeltaToken: async (id, token) =>
 *     token
 *       ? localStorage.setItem(`outlook-delta:${id}`, token)
 *       : localStorage.removeItem(`outlook-delta:${id}`),
 * };
 * ```
 */
export interface OutlookSyncStorage {
  /**
   * Return the last persisted delta token for a calendar, or null if none exists.
   * The delta token is returned by the Microsoft Graph API as `@odata.deltaLink`
   * at the end of a calendarView response.
   */
  getDeltaToken(calendarId: string): Promise<string | null>;

  /**
   * Persist the delta token after a sync. Pass null to clear the token
   * (e.g. when forcing a full re-sync because the token has expired).
   */
  setDeltaToken(calendarId: string, token: string | null): Promise<void>;
}
