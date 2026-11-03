# Placement credit in the candidate sheet

T5 · S2, S6, S10 · `odd/tasks/vacancy-team.md` and `docs/contracts/vacancy-team-v1.md`.

Resumen shows «Crédito del placement» only when the strictly decoded detail contains a non-null `placement_credit`. Team mode and recipients are the frozen hire snapshot, not today's vacancy team. Status and exit reason are shown as returned; the UI never computes episode status.

The block reads `GET V/participations/{pid}/placement-credits` only while mounted. «Colocaciones anteriores» excludes the current credit and preserves the server's newest-first order, capped at three rows. A failed list read has an explicit read-only retry.

«Anular crédito» and «Restaurar crédito» appear only from `can.void_credit` / `can.restore_credit`. Each opens `ConfirmActionDialog`, then posts `{}` with a UUID `Idempotency-Key` (no ETag). An uncertain response keeps the same frozen target/action/key for an explicit retry inside the confirmation. A cancelled/reopened confirmation starts a new attempt; no write retries automatically.

Success re-reads participation detail and refreshes the credit list. Restore can return «No se sostuvo» when its own placement episode ended. If the detail refresh fails after a confirmed write, the returned credit remains visible and further corrections are disabled until «Actualizar detalle» succeeds. Errors use `notifyActionResult` plus persistent `ActionStatus`; ended access uses the existing `TeamAccessEnded` surface.

## Composition audit

| Element | Reference / composition |
| --- | --- |
| Summary section | Existing sheet `section` + compact uppercase heading, no Card or new tabs |
| Status | `shadcn-reference/badge.md`: native Badge with success/review/neutral variant and lifecycle dot |
| Recipients | Existing Equipo avatar rows: Avatar + mandatory initials AvatarFallback (contract has no photo) |
| Confirmation | `shadcn-reference/alert-dialog.md`: shared ConfirmActionDialog owns header/media/title/description/footer; controlled without Trigger |
| Feedback | Existing ActionBar, reserved ActionStatusSlot, ActionStatus and notifyActionResult |

Browser review against :8081 (mobile, light/dark, nested dialogs and focus) is parent-owned; jsdom does not verify visual layout.
