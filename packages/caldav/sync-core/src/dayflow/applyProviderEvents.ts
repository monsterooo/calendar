import type { Event, ICalendarApp } from '@dayflow/core';

export type ApplyProviderEventsDelta = {
  added: number;
  updated: number;
  deleted: number;
};

export type ApplyProviderEventsOptions<DeletedRef = string> = {
  app: ICalendarApp;
  events: Event[];
  deleted?: DeletedRef[];
  /**
   * Return a stable provider identity for both incoming and existing local
   * events. This lets bindings match events even if the DayFlow id strategy
   * changes over time.
   */
  getProviderEventId?: (event: Event) => string | null | undefined;
  getDeletedProviderEventId?: (
    deleted: DeletedRef
  ) => string | null | undefined;
  getDeletedEventId?: (deleted: DeletedRef) => string | null | undefined;
  resolveUpdate?: (remote: Event, existing: Event) => Partial<Event>;
};

function addProviderEventIndex(
  index: Map<string, Event>,
  event: Event,
  getProviderEventId?: (event: Event) => string | null | undefined
) {
  const providerId = getProviderEventId?.(event);
  if (providerId) {
    index.set(providerId, event);
  }
}

/**
 * Apply provider-owned event additions, updates, and deletions to DayFlow.
 *
 * Provider bindings should prefer matching by provider identity first when
 * possible, then by DayFlow id as a fallback. This keeps app state stable if a
 * provider package changes its local id strategy.
 */
export function applyProviderEventsToDayFlow<DeletedRef = string>({
  app,
  events,
  deleted = [],
  getProviderEventId,
  getDeletedProviderEventId,
  getDeletedEventId,
  resolveUpdate,
}: ApplyProviderEventsOptions<DeletedRef>): ApplyProviderEventsDelta {
  const currentEvents = app.getAllEvents();
  const existingById = new Map(currentEvents.map(event => [event.id, event]));
  const existingByProviderId = new Map<string, Event>();
  for (const event of currentEvents) {
    addProviderEventIndex(existingByProviderId, event, getProviderEventId);
  }

  const adds: Event[] = [];
  const updates: Array<{ id: string; updates: Partial<Event> }> = [];
  const deletes: string[] = [];

  for (const event of events) {
    const providerId = getProviderEventId?.(event);
    const existing =
      (providerId ? existingByProviderId.get(providerId) : undefined) ??
      existingById.get(event.id);

    if (existing) {
      updates.push({
        id: existing.id,
        updates: resolveUpdate?.(event, existing) ?? event,
      });
      continue;
    }

    adds.push(event);
  }

  for (const deletedRef of deleted) {
    const eventId = getDeletedEventId?.(deletedRef);
    const providerId = getDeletedProviderEventId?.(deletedRef);
    const existing =
      (eventId ? existingById.get(eventId) : undefined) ??
      (providerId ? existingByProviderId.get(providerId) : undefined);

    if (existing) {
      deletes.push(existing.id);
    }
  }

  if (adds.length > 0 || updates.length > 0 || deletes.length > 0) {
    app.applyEventsChanges(
      {
        ...(adds.length > 0 ? { add: adds } : {}),
        ...(updates.length > 0 ? { update: updates } : {}),
        ...(deletes.length > 0 ? { delete: deletes } : {}),
      },
      false,
      'remote' as never
    );
  }

  return {
    added: adds.length,
    updated: updates.length,
    deleted: deletes.length,
  };
}
