import type { Lifecycle, StartReplacementBlocker } from "./model";

/**
 * replacement-processes-v1 lifecycle keys, read defensively: an old backend does not send them, and then there is
 * no replacement UI at all (contract «Deployment order»). Every helper here answers «nothing» for that payload.
 */
export const isReplacementAware = (lifecycle: Lifecycle): boolean => lifecycle.kind !== undefined;

const BLOCKER_COPY: Readonly<Record<StartReplacementBlocker, string>> = {
  source_not_closed: "Cierra la vacante para iniciar un reemplazo.",
  not_latest: "Esta vacante ya tiene un proceso más reciente. Inicia el reemplazo desde ese proceso.",
  replacement_active: "Ya hay un reemplazo en curso. Solo puede haber uno activo por vacante.",
  no_startable_credits: "No hay bajas pendientes de reemplazar.",
};
export const startReplacementBlockerCopy = (blocker: StartReplacementBlocker): string => BLOCKER_COPY[blocker];

export type StartOffer =
  | { kind: "none" }
  | { kind: "ready" }
  | { kind: "blocked"; reason: string; activeReplacementId: string | null };

/** What the «Iniciar reemplazo» entry points show for this lifecycle view (the backend decides, never the client). */
export function startOffer(lifecycle: Lifecycle): StartOffer {
  if (!isReplacementAware(lifecycle)) return { kind: "none" };
  if (lifecycle.can_start_replacement) return { kind: "ready" };
  return {
    kind: "blocked",
    reason: lifecycle.start_replacement_blocker ? BLOCKER_COPY[lifecycle.start_replacement_blocker] : "No se puede iniciar un reemplazo ahora.",
    activeReplacementId: lifecycle.active_replacement_id ?? null,
  };
}

/** Original ↔ replacement links of one process. `selfId` keeps a closed-active replacement from linking to itself. */
export function linkedProcesses(lifecycle: Lifecycle, selfId: string) {
  const active = lifecycle.active_replacement_id ?? null;
  return {
    replacement: lifecycle.kind === "replacement",
    privateReplacement: lifecycle.kind === "replacement" && lifecycle.visibility === "private",
    replacementOf: lifecycle.replacement_of ?? null,
    activeReplacementId: active !== null && active !== selfId ? active : null,
  };
}
