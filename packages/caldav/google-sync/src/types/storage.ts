/**
 * Minimal sync-state persistence interface for Google Calendar sync.
 *
 * Provides a storage backend for sync tokens so incremental sync survives
 * page reloads. The interface intentionally covers only what the sync engine
 * needs — it does not prescribe how calendars or events are stored.
 *
 * Implement with any K/V backend:
 *
 * ```ts
 * // localStorage example
 * const storage: GoogleSyncStorage = {
 *   getSyncToken: async (id) => localStorage.getItem(`google-token:${id}`),
 *   setSyncToken: async (id, token) =>
 *     token
 *       ? localStorage.setItem(`google-token:${id}`, token)
 *       : localStorage.removeItem(`google-token:${id}`),
 * };
 * ```
 */
export interface GoogleSyncStorage {
  /**
   * Return the last persisted sync token for a calendar, or null if none exists.
   * Used by the sync engine to perform incremental (delta) syncs instead of
   * fetching the full event list on every call.
   */
  getSyncToken(calendarId: string): Promise<string | null>;

  /**
   * Persist the sync token returned by the Google Calendar API after a sync.
   * Pass null to clear a token (e.g. when forcing a full re-sync).
   */
  setSyncToken(calendarId: string, token: string | null): Promise<void>;
}
