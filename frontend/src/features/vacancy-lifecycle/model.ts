import { z } from "zod";

export const closeReasonSchema = z.enum(["filled", "cancelled", "other"]);
export type CloseReason = z.infer<typeof closeReasonSchema>;
export type CloseCoverage = { covered: number; required: number | null };
export const normalizeCloseNote = (value: string) => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
export const closeNoteLength = (value: string) => Array.from(normalizeCloseNote(value)).length;
export const closeBodySchema = z.object({
  process: z.enum(["continue", "finish"]),
  reason: closeReasonSchema,
  reason_note: z.string().transform(normalizeCloseNote).nullable(),
}).strict().refine(body => body.reason === "other"
  ? body.reason_note !== null && closeNoteLength(body.reason_note) > 0 && closeNoteLength(body.reason_note) <= 200
  : body.reason_note === null, { path: ["reason_note"], message: "Escribe un motivo de hasta 200 caracteres." });
export type CloseBody = z.infer<typeof closeBodySchema>;
export const closeReasonLabel = (reason: CloseReason | null) => reason === null ? "Sin motivo registrado" : ({ filled: "Cubierta", cancelled: "Cancelada", other: "Otro" })[reason];
export const closeCoverageMessage = (coverage: CloseCoverage) => coverage.required === null
  ? "Esta vacante no tiene un objetivo de posiciones."
  : coverage.required === 1
    ? `Hay ${coverage.covered} de 1 posición cubierta.`
    : `Hay ${coverage.covered} de ${coverage.required} posiciones cubiertas.`;

export const lifecycleActionSchema = z.enum(["publish", "pause", "resume", "close", "finish_process", "reopen"]);
export const lifecycleSchema = z.object({
  publication: z.enum(["published", "paused", "closed"]).nullable(),
  process: z.enum(["active", "finished"]).nullable(),
  version: z.string().regex(/^(0|[1-9]\d*)$/),
  published_at: z.string().nullable(),
  paused_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  close_reason: closeReasonSchema.nullable(),
  close_reason_note: z.string().nullable(),
  process_finished_at: z.string().nullable(),
  allowed_actions: z.array(lifecycleActionSchema),
}).strict().refine(view =>
  view.publication === null ? view.process === null :
    view.process === "active" || (view.publication === "closed" && view.process === "finished"),
{ message: "Invalid lifecycle axes" });
export type Lifecycle = z.infer<typeof lifecycleSchema>;
export type LifecycleAction = z.infer<typeof lifecycleActionSchema>;

/** Never substitute a draft-content ETag for this independent concurrency token. */
export function decodeLifecycleEtag(value: unknown, draftId: string, version?: string): string {
  if (typeof value !== "string") throw new Error("Missing lifecycle ETag");
  const match = /^"vl-([0-9a-f-]{36})-v(0|[1-9]\d*)"$/i.exec(value);
  if (!match || match[1].toLowerCase() !== draftId.toLowerCase() || (version !== undefined && match[2] !== version)) {
    throw new Error("Invalid lifecycle ETag");
  }
  return value;
}

export function lifecycleLabel(view: Pick<Lifecycle, "publication" | "process">): string {
  switch (view.publication) {
    case null: return "Borrador";
    case "published": return "Activa"; // Same label as the header bar, the filter and the metric.
    case "paused": return "Pausada";
    case "closed": return view.process === "finished" ? "Cerrada · proceso finalizado" : "Cerrada · proceso en curso";
  }
}
