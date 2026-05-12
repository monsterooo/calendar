import { applyRemoteSnapshot } from '../snapshot/applyRemoteSnapshot';

type TestCalendar = { id: string; name: string; source?: string };
type TestEvent = { id: string; title: string; source?: string };

function createApp({
  calendars = [],
  events = [],
}: {
  calendars?: TestCalendar[];
  events?: TestEvent[];
}) {
  const state = {
    calendars: [...calendars],
    events: [...events],
  };
  const calls = {
    deletedCalendars: [] as string[],
    deletedEvents: [] as string[],
  };

  return {
    state,
    calls,
    app: {
      getCalendars: () => state.calendars,
      createCalendar: async (calendar: TestCalendar) => {
        state.calendars.push(calendar);
      },
      updateCalendar: (id: string, calendar: Partial<TestCalendar>) => {
        state.calendars = state.calendars.map(existing =>
          existing.id === id ? { ...existing, ...calendar } : existing
        );
      },
      deleteCalendar: async (id: string) => {
        calls.deletedCalendars.push(id);
        state.calendars = state.calendars.filter(
          calendar => calendar.id !== id
        );
      },
      getAllEvents: () => state.events,
      applyEventsChanges: (changes: {
        add?: TestEvent[];
        update?: Array<{ id: string; updates: Partial<TestEvent> }>;
        delete?: string[];
      }) => {
        for (const event of changes.add ?? []) {
          state.events.push(event);
        }
        for (const update of changes.update ?? []) {
          state.events = state.events.map(event =>
            event.id === update.id ? { ...event, ...update.updates } : event
          );
        }
        for (const id of changes.delete ?? []) {
          calls.deletedEvents.push(id);
          state.events = state.events.filter(event => event.id !== id);
        }
      },
    },
  };
}

describe('applyRemoteSnapshot', () => {
  it('deletes owned local records missing from an authoritative snapshot by default', async () => {
    const { app, state, calls } = createApp({
      calendars: [{ id: 'cal-old', name: 'Old', source: 'Provider' }],
      events: [{ id: 'event-old', title: 'Old', source: 'Provider' }],
    });

    const delta = await applyRemoteSnapshot(
      app as never,
      { calendars: [], events: [] },
      {
        isOwnedCalendar: calendar => calendar.source === 'Provider',
        isOwnedEvent: event => (event as TestEvent).source === 'Provider',
      }
    );

    expect(delta.calendars.deleted).toBe(1);
    expect(delta.events.deleted).toBe(1);
    expect(calls.deletedCalendars).toEqual(['cal-old']);
    expect(calls.deletedEvents).toEqual(['event-old']);
    expect(state.calendars).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it('can preserve missing records for partial snapshots', async () => {
    const { app, state, calls } = createApp({
      calendars: [{ id: 'cal-old', name: 'Old', source: 'Provider' }],
      events: [{ id: 'event-old', title: 'Old', source: 'Provider' }],
    });

    const delta = await applyRemoteSnapshot(
      app as never,
      { calendars: [], events: [] },
      {
        isOwnedCalendar: calendar => calendar.source === 'Provider',
        isOwnedEvent: event => (event as TestEvent).source === 'Provider',
        deleteMissingCalendars: false,
        deleteMissingEvents: false,
      }
    );

    expect(delta.calendars.deleted).toBe(0);
    expect(delta.events.deleted).toBe(0);
    expect(calls.deletedCalendars).toEqual([]);
    expect(calls.deletedEvents).toEqual([]);
    expect(state.calendars).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });
});
