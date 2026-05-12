# @dayflow/sync-core

Provider-neutral sync primitives for DayFlow calendar integrations.

This package contains shared sync types and snapshot reconciliation helpers. It
does not include provider adapters, authentication, credential storage, history
recording, or persistence implementations.

## Design Boundary

`@dayflow/sync-core` emits provider-neutral changes such as
`calendar.created`, `event.updated`, and `event.deleted`. Applications may use
those changes to build audit logs, activity history, analytics, or notifications,
but those features live outside this package.

This keeps the core sync layer small and lets apps opt into history only when
they need it.

## DayFlow Binding Helpers

Provider packages can share the same DayFlow event apply path through
`applyProviderEventsToDayFlow`. The helper matches incoming remote events
against existing app events by provider identity first, then DayFlow id, and
applies additions, updates, and deletions with `source: 'remote'`.

Use this when a provider package changes or customizes its local id strategy.
The provider identity keeps existing app state from being duplicated or
overwritten by an unrelated local event with the same id.

## Snapshot Safety

`applyRemoteSnapshot` can delete owned local records that are missing from a
remote snapshot. That is appropriate only for authoritative full snapshots. For
partial responses, pass `deleteMissingCalendars: false` or
`deleteMissingEvents: false` and let the application decide cleanup policy.
