import { expect, it } from "vitest";
import { isReplacementAware, linkedProcesses, startOffer, startReplacementBlockerCopy } from "./replacement-state";
import type { Lifecycle } from "./model";

const root = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const other = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const base: Lifecycle = { close_reason: "filled", close_reason_note: null, publication: "closed", process: "finished", version: "5", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: [] };

it("an old backend payload (no replacement keys) is not replacement-aware and offers nothing", () => {
  expect(isReplacementAware(base)).toBe(false);
  expect(startOffer(base)).toEqual({ kind: "none" });
  expect(linkedProcesses(base, root)).toEqual({ replacementOf: null, activeReplacementId: null, replacement: false, privateReplacement: false });
});
it("offers the start when the backend says so", () => {
  expect(startOffer({ ...base, kind: "original", can_start_replacement: true, start_replacement_blocker: null })).toEqual({ kind: "ready" });
});
it.each([
  ["source_not_closed", "Cierra la vacante para iniciar un reemplazo."],
  ["not_latest", "Esta vacante ya tiene un proceso más reciente. Inicia el reemplazo desde ese proceso."],
  ["replacement_active", "Ya hay un reemplazo en curso. Solo puede haber uno activo por vacante."],
  ["no_startable_credits", "No hay bajas pendientes de reemplazar."],
] as const)("explains the %s blocker", (blocker, copy) => {
  expect(startReplacementBlockerCopy(blocker)).toBe(copy);
  expect(startOffer({ ...base, kind: "original", can_start_replacement: false, start_replacement_blocker: blocker, active_replacement_id: blocker === "replacement_active" ? other : null }))
    .toEqual({ kind: "blocked", reason: copy, activeReplacementId: blocker === "replacement_active" ? other : null });
});
it("falls back to a generic reason when the blocker is absent", () => {
  expect(startOffer({ ...base, kind: "original", can_start_replacement: false })).toEqual({ kind: "blocked", reason: "No se puede iniciar un reemplazo ahora.", activeReplacementId: null });
});
it("links a replacement to its original and flags private replacements", () => {
  expect(linkedProcesses({ ...base, kind: "replacement", replacement_of: root, visibility: "private", active_replacement_id: other }, other))
    .toEqual({ replacement: true, privateReplacement: true, replacementOf: root, activeReplacementId: null });
});
it("an original links to the active replacement, never to itself", () => {
  expect(linkedProcesses({ ...base, kind: "original", active_replacement_id: other }, root)).toMatchObject({ replacement: false, activeReplacementId: other });
  expect(linkedProcesses({ ...base, kind: "replacement", replacement_of: root, active_replacement_id: other }, other).activeReplacementId).toBeNull();
});
