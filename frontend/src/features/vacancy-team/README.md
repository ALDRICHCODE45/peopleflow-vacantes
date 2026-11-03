# Equipo de la vacante

Development opt-in only: `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=1` uses isolated in-memory fixtures; `=api` uses authenticated server actions. Unset flags and production keep this entry hidden. The approved team layout is shared by both adapters.

## Real writes

`writeTeamAction` authenticates on the server; `api-client.ts` validates input, uses the shared guarded JSON transport, and decodes the full team plus its strong ETag. The six operations are add, remove, leave, deadline, reassign and mode. Every write sends the team's `If-Match`; POSTs additionally send a UUID `Idempotency-Key`.

A dialog opening starts a new confirmation attempt. The API adapter freezes its body, ETag and UUID. An uncertain response keeps that attempt for explicit confirmation again (no automatic retries); its fields remain inert until it resolves or the dialog closes. A definitive validation rejection keeps the dialog's values but releases the attempt so corrected input gets a fresh UUID. Successful writes replace the visible team and ETag and reload history from its first page.

Feedback uses `notifyActionResult` and `ActionStatus`: API success confirms a server save, fixture success explicitly says it is only in memory. A 412 reloads team and first-page history; a 403 reloads capabilities; `team_access_ended` replaces the view with the ended-access card. Validation failures keep the dialog open without success feedback.

Reassigning an existing member preserves their deadline; only a new member can receive a deadline in that confirmation. Switching to shared mode omits `responsible_user_id`. Saved snapshots use captured stage kinds and show elapsed days without a time progress bar when no deadline exists. Candidate stages with neither active nor discarded candidates are omitted; an entirely empty distribution says «Aún no había candidatos».

The delivery read supplies both the calendar and the current commitment date, independently of saved snapshots. Add, deadline and reassignment helpers use that date; a null date says «Sin plazo propio. Esta vacante todavía no tiene fecha compromiso.». Shared person pickers sort names with es-MX collation without changing the source list.

Movements suppress redundant function-change rows when the loaded history includes a reassignment involving that user, or a team-wide mode change, at the same instant to the second. Joins and leaves remain visible. Self-reassignments say «le pasó la vacante a» instead of repeating the actor. The current-team footer reserves its own full-width status row above the actions (requested exception to §12); mobile actions still stack full width.
