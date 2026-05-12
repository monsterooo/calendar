import { reconcileProviderCalendars } from '../engine/reconcileProviderCalendars';

type RemoteCalendar = { id: string; summary: string };
type CalendarRecord = {
  id: string;
  externalCalendarId: string;
  name: string;
  active: boolean;
  updatedAt?: string;
};

function mapRemoteCalendar(
  remote: RemoteCalendar,
  existing?: CalendarRecord
): CalendarRecord {
  return {
    id: existing?.id ?? `local-${remote.id}`,
    externalCalendarId: remote.id,
    name: remote.summary,
    active: true,
  };
}

describe('reconcileProviderCalendars', () => {
  it('ignores extra local bookkeeping fields in the default equality check', async () => {
    const existing: CalendarRecord[] = [
      {
        id: 'local-cal-1',
        externalCalendarId: 'cal-1',
        name: 'Work',
        active: true,
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    const save = jest.fn();
    const deactivate = jest.fn();

    const result = await reconcileProviderCalendars({
      provider: 'test',
      remoteCalendars: [{ id: 'cal-1', summary: 'Work' }],
      existingCalendars: existing,
      getRemoteCalendarId: remote => remote.id,
      getRecordId: record => record.id,
      getRecordExternalCalendarId: record => record.externalCalendarId,
      mapRemoteCalendar,
      save,
      deactivate,
    });

    expect(result.changed).toBe(false);
    expect(result.changes).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('saves created and updated calendars and deactivates missing ones via callbacks', async () => {
    const existing: CalendarRecord[] = [
      {
        id: 'local-cal-1',
        externalCalendarId: 'cal-1',
        name: 'Old Work',
        active: true,
      },
      {
        id: 'local-cal-old',
        externalCalendarId: 'cal-old',
        name: 'Removed',
        active: true,
      },
    ];

    const result = await reconcileProviderCalendars({
      provider: 'test',
      remoteCalendars: [
        { id: 'cal-1', summary: 'Work' },
        { id: 'cal-2', summary: 'Personal' },
      ],
      existingCalendars: existing,
      getRemoteCalendarId: remote => remote.id,
      getRecordId: record => record.id,
      getRecordExternalCalendarId: record => record.externalCalendarId,
      mapRemoteCalendar,
      save: records => records,
      deactivate: records =>
        records.map(record => ({
          ...record,
          active: false,
        })),
    });

    expect(result.changed).toBe(true);
    expect(result.changes.map(change => change.type)).toEqual([
      'calendar.updated',
      'calendar.created',
      'calendar.removed',
    ]);
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ externalCalendarId: 'cal-1', name: 'Work' }),
        expect.objectContaining({
          externalCalendarId: 'cal-2',
          name: 'Personal',
        }),
        expect.objectContaining({
          externalCalendarId: 'cal-old',
          active: false,
        }),
      ])
    );
  });
});
