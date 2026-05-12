import type { CalendarType, Event, ICalendarApp } from '@dayflow/core';
import { Temporal } from 'temporal-polyfill';

import { applyProviderEventsToDayFlow } from '../dayflow/applyProviderEvents';

function makeEvent(id: string, providerId: string): Event {
  return {
    id,
    title: id,
    start: Temporal.PlainDate.from('2025-01-01'),
    end: Temporal.PlainDate.from('2025-01-01'),
    meta: { providerId },
  };
}

function makeApp(events: Event[] = []): ICalendarApp {
  return {
    getAllEvents: jest.fn(() => [...events]),
    applyEventsChanges: jest.fn(
      (batch: {
        add?: Event[];
        update?: Array<{ id: string; updates: Partial<Event> }>;
        delete?: string[];
      }) => {
        events.push(...(batch.add ?? []));
        for (const update of batch.update ?? []) {
          const index = events.findIndex(event => event.id === update.id);
          if (index !== -1) {
            events[index] = { ...events[index], ...update.updates };
          }
        }
        for (const id of batch.delete ?? []) {
          const index = events.findIndex(event => event.id === id);
          if (index !== -1) {
            events.splice(index, 1);
          }
        }
      }
    ),
    getCalendars: jest.fn(() => [] as CalendarType[]),
    createCalendar: jest.fn(),
    updateCalendar: jest.fn(),
    deleteCalendar: jest.fn(),
    subscribeEventChanges: jest.fn(),
    subscribeVisibleRangeChange: jest.fn(),
  } as unknown as ICalendarApp;
}

describe('applyProviderEventsToDayFlow', () => {
  it('matches existing events by provider identity when DayFlow ids differ', () => {
    const local = makeEvent('old-local-id', 'remote-1');
    const remote = makeEvent('new-provider-id', 'remote-1');
    remote.title = 'Remote title';
    const app = makeApp([local]);

    const delta = applyProviderEventsToDayFlow({
      app,
      events: [remote],
      getProviderEventId: event => event.meta?.providerId as string,
    });

    expect(delta).toEqual({ added: 0, updated: 1, deleted: 0 });
    expect(app.applyEventsChanges).toHaveBeenCalledWith(
      {
        update: [{ id: 'old-local-id', updates: remote }],
      },
      false,
      'remote'
    );
  });

  it('deletes existing events by provider identity', () => {
    const app = makeApp([makeEvent('local-id', 'remote-1')]);

    const delta = applyProviderEventsToDayFlow({
      app,
      events: [],
      deleted: ['remote-1'],
      getProviderEventId: event => event.meta?.providerId as string,
      getDeletedProviderEventId: deleted => deleted,
    });

    expect(delta).toEqual({ added: 0, updated: 0, deleted: 1 });
    expect(app.applyEventsChanges).toHaveBeenCalledWith(
      { delete: ['local-id'] },
      false,
      'remote'
    );
  });
});
