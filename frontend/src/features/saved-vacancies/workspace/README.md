# Saved workspace (T4)

`/candidato/guardadas` loads the real list through `loadSavedJobsAction` and the existing identity-scoped TanStack Query client. Initial loading reserves card slots; refetch leaves the list mounted. Closed availability takes precedence over an application. Every group preserves server order, and empty groups are omitted.

- Open rows without an application offer **Postularme**, except legacy jobs. All rows retain **Ver vacante** and the remove bookmark.
- Removal waits for confirmation. **Deshacer**, both in the result toast and in the persistent screen status, sends a new idempotent save.
- The closed disclosure starts collapsed. **Quitar las que ya no están disponibles** opens the shared `ConfirmActionDialog` / AlertDialog; **Cancelar** never writes. Confirmation calls the bulk endpoint and reports its actual removed count, not the old disclosure count. Failures leave the dialog open and preserve the list for explicit retry.
- Confirmed writes reuse `updateSavedJobIds` for single-job changes, invalidate the list and invalidate `savedJobIdsKey`. Bulk removal never guesses removed IDs from the snapshot.
- `applicationHref(id)` links to `/candidato/postulaciones?postulacion=<id>`. Parent-approved T6 will make the existing inbox honor that selection parameter; until then the link opens the applications list.

The limit includes closed jobs. Compensation and legacy salaries use the public cards' `previewSalaryParts` projection, with explicit unknown period/basis for legacy money.

The Playwright spec is authored but not executed. It requires a disposable, authenticated candidate environment with all groups preseeded, the runner's storage state, and `PLAYWRIGHT_SAVED_VACANCIES_ORIGIN`. It checks disclosure/confirmation focus, cancellation, responsive overflow and remove/undo. No services or credentials are created by the spec. Real-browser visual parity (including explicit dark theme) and real-backend integration remain T5 checks.
