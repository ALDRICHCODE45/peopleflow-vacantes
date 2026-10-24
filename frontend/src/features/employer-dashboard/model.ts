import { z } from "zod";

const count = z.number().int().nonnegative();
const uuid = z.string().uuid();
const person = z.object({ id: uuid, name: z.string() }).strict();
export const dashboardSchema = z.object({
  published_vacancies: count,
  in_process: count,
  pool_added_last_7_days: count,
  positions: z.object({ covered: count, required: count }).strict(),
  origin_by_day: z.array(z.object({ date: z.string().date(), organic: count, manual: count }).strict()).length(90)
    .refine(days => days.every((day, i) => i === 0 || Date.parse(day.date) - Date.parse(days[i - 1].date) === 86_400_000), "Expected consecutive days, oldest first"),
  recent: z.array(z.object({
    participation_id: uuid,
    candidate: person.extend({ kind: z.enum(["organic", "manual"]) }).strict(),
    vacancy: z.object({ id: uuid, title: z.string() }).strict(),
    stage: person,
    source: z.enum(["organic", "manual"]),
    applied_at: z.string().datetime({ offset: true }),
    added_by: person.nullable(),
  }).strict().refine(row => row.source === "organic" ? row.added_by === null : row.added_by !== null, "Source and added_by must agree")).max(10),
}).strict();
export const errorEnvelopeSchema = z.object({ error: z.string().min(1), code: z.string().min(1) }).strict();
export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardFailure = { ok: false; reason: "unauthenticated" | "forbidden" | "not_found" | "server_error" | "no_response" | "unrecognized_response"; reference: { status?: number; code?: string } };
export type DashboardResult = { ok: true; data: Dashboard } | DashboardFailure;
