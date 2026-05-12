import type {
  CalDAVEventSyncState,
  CalDAVStorage,
} from '@caldav/types/storage';

/**
 * Create an in-memory CalDAV storage adapter.
 *
 * Useful for quick starts and tests. Production apps should provide a durable
 * implementation backed by IndexedDB, localStorage, or their server/database.
 */
export function createMemoryCalDAVStorage(): CalDAVStorage {
  const syncTokens = new Map<string, string>();
  const ctags = new Map<string, string>();
  const etags = new Map<string, string>();
  const eventStates = new Map<string, CalDAVEventSyncState>();

  return {
    getSyncToken: async calendarId => syncTokens.get(calendarId) ?? null,
    setSyncToken: async (calendarId, token) => {
      if (token) {
        syncTokens.set(calendarId, token);
      } else {
        syncTokens.delete(calendarId);
      }
    },

    getCtag: async calendarId => ctags.get(calendarId) ?? null,
    setCtag: async (calendarId, ctag) => {
      ctags.set(calendarId, ctag);
    },

    getEtag: async href => etags.get(href) ?? null,
    setEtag: async (href, etag) => {
      etags.set(href, etag);
    },
    deleteEtag: async href => {
      etags.delete(href);
    },

    getEventState: async eventId => eventStates.get(eventId) ?? null,
    setEventState: async (eventId, state) => {
      eventStates.set(eventId, state);
    },
    deleteEventState: async eventId => {
      eventStates.delete(eventId);
    },

    clearCalendar: async calendarId => {
      syncTokens.delete(calendarId);
      ctags.delete(calendarId);

      for (const [eventId, state] of eventStates) {
        if (state.calendarId === calendarId) {
          eventStates.delete(eventId);
          if (state.etag) {
            etags.delete(state.href);
          }
        }
      }
    },
  };
}
