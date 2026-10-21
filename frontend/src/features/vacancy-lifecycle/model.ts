import { z } from "zod";

export const lifecycleActionSchema = z.enum(["publish", "pause", "resume", "close", "finish_process", "reopen"]);
export const lifecycleSchema = z.object({
  publication: z.enum(["published", "paused", "closed"]).nullable(),
  process: z.enum(["active", "finished"]).nullable(),
  version: z.string().regex(/^(0|[1-9]\d*)$/),
  published_at: z.string().nullable(),
  paused_at: z.string().nullable(),
  closed_at: z.string().nullable(),
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

export function lifecycleLabel(view: Lifecycle): string {
  switch (view.publication) {
    case null: return "Borrador";
    case "published": return "Publicada";
    case "paused": return "Pausada";
    case "closed": return view.process === "finished" ? "Cerrada · proceso finalizado" : "Cerrada · proceso en curso";
  }
}
