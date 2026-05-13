export type ICalPropertyParams = Record<string, string>;

export type ICalProperty = {
  value: string;
  params: ICalPropertyParams;
};

/** Structured representation of a single VEVENT block. */
export type ParsedVEvent = {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  transp?: string;
  url?: string;
  categories?: string[];
  organizer?: ICalProperty;
  attendees?: ICalProperty[];
  dtstart?: ICalProperty;
  dtend?: ICalProperty;
  recurrenceId?: ICalProperty;
  /** Raw DURATION value (e.g. PT1H) when DTEND is absent. */
  duration?: string;
  /** Raw RRULE value — presence indicates a recurring event. */
  rrule?: string;
  /** Exception dates for recurring events. */
  exdate?: ICalProperty[];
  /** Additional recurrence dates for recurring events. */
  rdate?: ICalProperty[];
  sequence?: number;
  created?: string;
  lastModified?: string;
};
