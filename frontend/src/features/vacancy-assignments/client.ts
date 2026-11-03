import { z } from "zod";
import { functionPeriodSchema } from "@/features/vacancy-team/model";

export const assignmentSchema = z.object({
  // null while the draft has no title yet (contract: string | null).
  vacancy_title: z.string().nullable(),
  draft_id: z.string().nullable(),
  requester: z.object({ kind: z.enum(["internal_area", "client"]), name: z.string() }).strict().nullable(),
  vacancy_status: z.object({ publication: z.enum(["draft", "published", "paused", "closed"]), process: z.enum(["active", "finished"]).nullable() }).strict(),
  business_days_in_tramo: z.number().int().nonnegative(),
  delivery_target: z.number().int().nonnegative().nullable(),
  deadline_result: z.enum(["on_time", "late", "pending", "unfinished", "not_applicable", "none"]),
  deadline_delta_business_days: z.number().int().nullable(),
  functions: z.array(functionPeriodSchema.pick({ function: true, started_at: true, ended_at: true }).strict()).min(1),
  started_at: z.string().datetime({ offset: true }), ended_at: z.string().datetime({ offset: true }).nullable(),
  end_cause: z.enum(["reassigned", "left", "removed", "membership_ended"]).nullable(),
  effective_deadline: z.string().date().nullable(), delivered_in_tramo: z.number().int().nonnegative(),
  placements: z.object({ direct: z.number().int().nonnegative(), participant: z.number().int().nonnegative(), shared: z.number().int().nonnegative() }).strict(),
}).strict();
export const historySchema = z.object({ items: z.array(assignmentSchema), next_cursor: z.string().nullable() }).strict();
export type Assignment = z.infer<typeof assignmentSchema>;
export type AssignmentHistoryPage = z.infer<typeof historySchema>;
export type AssignmentClient = { getHistory: (cursor?: string) => Promise<AssignmentHistoryPage> };
export type Summary = { current: number; delivered: number; placements: number; participant: number; incomplete: boolean };
export type ReadResult = { ok: true; data: AssignmentHistoryPage } | { ok: false; code: "unauthenticated" | "invalid_cursor" | "read_failed"; status?: number };
export class AssignmentError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
export const placementsCount = (item: Assignment) => item.placements.direct + item.placements.shared;
export const currentFirst = (items: Assignment[]) => [...items].sort((a, b) => Number(!!a.ended_at) - Number(!!b.ended_at) || b.started_at.localeCompare(a.started_at));

export function summarize(items: Assignment[], incomplete: boolean, previous?: Summary): Summary {
  return items.reduce<Summary>((sum, item) => ({ current: sum.current + Number(!item.ended_at), delivered: sum.delivered + item.delivered_in_tramo, placements: sum.placements + placementsCount(item), participant: sum.participant + item.placements.participant, incomplete }), { current: 0, delivered: 0, placements: 0, participant: 0, ...previous, incomplete });
}

/** No aggregate endpoint: read up to ten pages, then label totals as lower bounds.
 * The visible list remains cursor-paginated independently of summary preloading. */
export async function readOverview(client: AssignmentClient) {
  const first = historySchema.parse(await client.getHistory());
  const items = [...first.items];
  let cursor = first.next_cursor;
  const seen = new Set<string>();
  let pageCount = 1;
  while (cursor && pageCount < 10) {
    if (seen.has(cursor)) throw new Error("Repeated history cursor");
    seen.add(cursor);
    const page = historySchema.parse(await client.getHistory(cursor));
    items.push(...page.items); cursor = page.next_cursor; pageCount += 1;
  }
  return { first, summary: summarize(items, !!cursor), cursors: [...seen] };
}

export function createFixtureClient(scenario: "default" | "empty" | "error" | "loading" = "default"): AssignmentClient {
  const titles = ["Analista contable", "Diseñador de producto", "Coordinador de operaciones", "Especialista de nómina", "Analista de datos", "Líder de ingeniería", "Ejecutivo comercial", "Generalista de recursos humanos", "Supervisor de almacén", "Analista financiero", "Gerente de atención a clientes", "Especialista de compras", "Asistente administrativo", "Coordinador de proyectos"];
  const functions = ["responsible", "collaborator", "member"] as const;
  const causes = ["reassigned", "left", "removed", "membership_ended"] as const;
  const items: Assignment[] = scenario === "empty" ? [] : titles.map((vacancy_title, index) => {
    const ended_at = index < 3 ? null : "2026-11-12T18:00:00Z";
    const started_at = "2026-11-02T18:00:00Z";
    const deadline_result = (["on_time", "late", "pending", "unfinished", "not_applicable", "none"] as const)[index % 6];
    return { vacancy_title, draft_id: ended_at ? null : `fixture-vacancy-${index + 1}`, requester: index % 3 === 2 ? null : { kind: index % 2 ? "internal_area" : "client", name: index % 2 ? "Finanzas" : "Grupo Norte" }, vacancy_status: { publication: (["published", "draft", "paused", "closed"] as const)[index % 4], process: index % 4 === 1 ? null : ended_at ? "finished" : "active" }, business_days_in_tramo: ended_at ? 8 : 1, delivery_target: index % 6 === 5 ? null : 5, deadline_result, deadline_delta_business_days: deadline_result === "none" || deadline_result === "not_applicable" ? null : deadline_result === "late" ? -3 : 2, functions: index === 0 ? [{ function: "collaborator", started_at, ended_at: "2026-11-04T18:00:00Z" }, { function: "responsible", started_at: "2026-11-04T18:00:00Z", ended_at }] : [{ function: functions[index % 3], started_at, ended_at }], started_at, ended_at, end_cause: ended_at ? causes[(index - 3) % 4] : null, effective_deadline: "2026-11-20", delivered_in_tramo: index === 0 ? 8 : index % 4, placements: { direct: index === 0 ? 1 : 0, participant: index % 3 === 1 ? 1 : 0, shared: index % 3 === 2 ? 1 : 0 } };
  });
  return { async getHistory(cursor) {
    if (scenario === "error") throw new Error("Fixture read failed");
    if (scenario === "loading") return new Promise<AssignmentHistoryPage>(() => {});
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset < 0 || offset > items.length) throw new Error("Invalid cursor");
    return historySchema.parse({ items: currentFirst(items).slice(offset, offset + 10), next_cursor: offset + 10 < items.length ? String(offset + 10) : null });
  } };
}
