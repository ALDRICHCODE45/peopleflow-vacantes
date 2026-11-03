import { z } from "zod";

export const prototypeEnabled = (environment: string | undefined, flag: string | undefined) => environment === "development" && flag === "1";
export const fixtureNames = ["owner", "collaborator", "shared", "long-history", "empty-history"] as const;
export type FixtureName = typeof fixtureNames[number];
export const teamFunctionSchema = z.enum(["responsible", "collaborator", "member"]);
export const modeSchema = z.enum(["with_responsible", "shared"]);
const userSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const dateSchema = z.string().date();
const instantSchema = z.string().datetime();
export const canSchema = z.object({ add_member: z.boolean(), remove_member: z.boolean(), leave: z.boolean(), reassign_responsible: z.boolean(), change_mode: z.boolean(), edit_deadline: z.boolean(), renegotiate_commitment: z.boolean() });
export const memberSchema = z.object({ assignment_id: z.string(), user: userSchema, function: teamFunctionSchema, started_at: instantSchema, recruiter_deadline: dateSchema.nullable(), effective_deadline: dateSchema.nullable(), deadline_source: z.enum(["recruiter", "commitment", "none"]) });
export const teamSchema = z.object({ mode: modeSchema, members: z.array(memberSchema).min(1), viewer: z.object({ function: teamFunctionSchema.nullable(), is_owner: z.boolean(), can: canSchema }) });
export const companyMembersSchema = z.object({ members: z.array(z.object({ id: z.string(), role: z.enum(["owner", "recruiter"]), user: z.object({ id: z.string(), full_name: z.string(), email: z.string().email() }) })) });
export const reasons = [
  { value: "workload", label: "Carga de trabajo" }, { value: "recruiter_departure", label: "Baja del reclutador" },
  { value: "performance", label: "Desempeño" }, { value: "client_request", label: "Pedido del cliente" }, { value: "other", label: "Otro" },
] as const;
export const reasonSchema = z.enum(["workload", "recruiter_departure", "performance", "client_request", "other"]);
export const reassignSchema = z.object({
  to_user_id: z.string().min(1), reason: reasonSchema,
  note: z.string().transform(value => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")).refine(value => Array.from(value).length <= 500, "Usa hasta 500 caracteres.").refine(value => !/[\p{Cc}]/u.test(value.replace(/[\n\t]/g, "")), "Quita los caracteres de control.").optional(),
  recruiter_deadline: dateSchema.nullable(), previous_responsible: z.enum(["remove", "keep_as_collaborator"]).default("remove"),
}).superRefine((body, ctx) => {
  if (body.reason === "other" && !body.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Escribe una nota para Otro." });
});
export const snapshotSchema = z.object({
  captured_at: instantSchema,
  lifecycle: z.object({ publication: z.enum(["draft", "published", "paused", "closed"]), process: z.enum(["active", "finished"]).nullable() }),
  stage_counts: z.array(z.object({ stage_id: z.string(), stage_name: z.string(), active: z.number().int().nonnegative(), discarded: z.number().int().nonnegative() })),
  tramo: z.object({ started_at: instantSchema, effective_deadline: dateSchema.nullable(), deadline_source: z.enum(["recruiter", "commitment", "none"]), business_days_elapsed: z.number().nullable(), business_days_total: z.number().nullable() }),
  delivery: z.object({ target: z.number().nullable(), delivered: z.number(), fulfilled_at: instantSchema.nullable(), result: z.string().nullable(), commitment_date: dateSchema.nullable() }),
  placements: z.object({ current: z.number(), credited: z.number() }),
});
const startCauseSchema = z.enum(["creation", "added", "reassignment", "backfill"]);
export const functionPeriodSchema = z.object({ function: teamFunctionSchema, started_at: instantSchema, ended_at: instantSchema.nullable(), start_cause: z.enum(["creation", "added", "reassignment", "mode_change", "backfill"]), end_cause: z.enum(["reassignment", "mode_change", "tramo_ended"]).nullable() });
export const tramoSchema = z.object({ assignment_id: z.string(), user: userSchema, started_at: instantSchema, started_by: userSchema.nullable(), start_cause: startCauseSchema, ended_at: instantSchema.nullable(), ended_by: userSchema.nullable(), end_cause: z.enum(["removed", "left", "reassigned", "membership_ended"]).nullable(), recruiter_deadline: dateSchema.nullable(), closing_deadline: dateSchema.nullable(), functions: z.array(functionPeriodSchema) });
export const historyItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tramo"), at: instantSchema, tramo: tramoSchema }),
  z.object({ kind: z.literal("reassignment"), at: instantSchema, reassignment: z.object({ id: z.string(), from_user: userSchema, to_user: userSchema, reason: reasonSchema, note: z.string().nullable(), previous_responsible: z.enum(["remove", "keep_as_collaborator"]), performed_by: userSchema, state_snapshot: snapshotSchema }) }),
  z.object({ kind: z.literal("mode_change"), at: instantSchema, mode_change: z.object({ id: z.string(), from_mode: modeSchema, to_mode: modeSchema, responsible_user: userSchema.nullable(), performed_by: userSchema }) }),
]);
export const historySchema = z.object({ items: z.array(historyItemSchema), next_cursor: z.string().nullable() });
export type Team = z.infer<typeof teamSchema>;
export type Member = z.infer<typeof memberSchema>;
export type CompanyMembers = z.infer<typeof companyMembersSchema>;
export type Reassign = z.infer<typeof reassignSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type HistoryItem = z.infer<typeof historyItemSchema>;
export type History = z.infer<typeof historySchema>;
export type Tramo = z.infer<typeof tramoSchema>;
export type ModeChange = { mode: Team["mode"]; responsible_user_id?: string };
export const availableMembers = (team: Team, company: CompanyMembers) => company.members.filter(member => !team.members.some(active => active.user.id === member.user.id));
/** UI capabilities are never reconstructed from role or function. */
export const memberActions = (can: Team["viewer"]["can"]) => [can.edit_deadline && "deadline", can.remove_member && "remove"].filter(Boolean) as ("deadline" | "remove")[];
export const memberActionLabel = { deadline: "Editar plazo", remove: "Quitar" } as const;
export const functionLabel = { responsible: "Responsable", collaborator: "Colaborador", member: "Miembro" };
export const modeLabel = { with_responsible: "Con responsable", shared: "Equipo sin responsable" };
export const sourceLabel = { recruiter: "Propio", commitment: "Fecha compromiso", none: "Sin plazo" };
export function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" }).format(new Date(`${value}T12:00:00Z`));
}
export function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}
