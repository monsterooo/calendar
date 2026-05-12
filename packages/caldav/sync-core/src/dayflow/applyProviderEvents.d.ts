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
/**
 * Apply provider-owned event additions, updates, and deletions to DayFlow.
 *
 * Provider bindings should prefer matching by provider identity first when
 * possible, then by DayFlow id as a fallback. This keeps app state stable if a
 * provider package changes its local id strategy.
 */
export declare function applyProviderEventsToDayFlow<DeletedRef = string>({
  app,
  events,
  deleted,
  getProviderEventId,
  getDeletedProviderEventId,
  getDeletedEventId,
  resolveUpdate,
}: ApplyProviderEventsOptions<DeletedRef>): ApplyProviderEventsDelta;
