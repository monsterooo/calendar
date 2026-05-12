import type { Event } from '@dayflow/core';
import type {
  OutlookDateTimeValue,
  OutlookEventInput,
} from '@outlook-sync/types/api';
import { Temporal } from 'temporal-polyfill';

function isPlainDate(
  dt: Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime
): dt is Temporal.PlainDate {
  return dt instanceof Temporal.PlainDate;
}

function formatOutlookDateTime(
  dt: Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime,
  isEnd = false
): OutlookDateTimeValue {
  if (isPlainDate(dt)) {
    // All-day: Outlook end is exclusive — add one day when formatting end
    const adjusted = isEnd ? dt.add({ days: 1 }) : dt;
    return {
      dateTime: `${adjusted.toString()}T00:00:00.0000000`,
      timeZone: 'UTC',
    };
  }

  if ('timeZoneId' in dt) {
    const zdt = dt as Temporal.ZonedDateTime;
    // Remove sub-second precision and trailing offset — Outlook wants plain ISO + timeZone field
    const plain = zdt.toPlainDateTime().toString({ smallestUnit: 'second' });
    return {
      dateTime: `${plain}.0000000`,
      timeZone: zdt.timeZoneId,
    };
  }

  // PlainDateTime — no timezone info
  const pdt = dt as Temporal.PlainDateTime;
  return {
    dateTime: `${pdt.toString({ smallestUnit: 'second' })}.0000000`,
    timeZone: 'UTC',
  };
}

/**
 * Map a DayFlow Event to an Outlook EventInput for create/update operations.
 */
export function mapDayFlowEventToOutlook(event: Event): OutlookEventInput {
  const isAllDay = Boolean(event.allDay) || isPlainDate(event.start);

  return {
    subject: event.title,
    ...(event.description
      ? { body: { contentType: 'text', content: event.description } }
      : {}),
    start: formatOutlookDateTime(event.start, false),
    end: formatOutlookDateTime(event.end, isAllDay),
    isAllDay,
    ...(typeof event.meta?.location === 'string' && event.meta.location
      ? { location: { displayName: event.meta.location } }
      : {}),
  };
}
