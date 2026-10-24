import type { Dashboard } from "./model";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
export const vacancyId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
export const personId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
export const dashboard: Dashboard = {
  published_vacancies: 2, in_process: 5, pool_added_last_7_days: 7, positions: { covered: 3, required: 5 },
  origin_by_day: Array.from({ length: 90 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 26 + i)).toISOString().slice(0, 10), organic: i === 89 ? 4 : 0, manual: i === 89 ? 2 : 0 })),
  recent: [{ participation_id: vacancyId, candidate: { kind: "organic", id: personId, name: "Ana Real", professional_title: "Ingeniera" }, vacancy: { id: vacancyId, title: "Plataforma real" }, stage: { id: personId, name: "Entrevista", kind: "in_process" }, source: "organic", applied_at: "2026-10-24T01:00:00Z", added_by: null },
    { participation_id: personId, candidate: { kind: "organic", id: personId, name: "Luis Real", professional_title: null }, vacancy: { id: vacancyId, title: "Plataforma real" }, stage: { id: personId, name: "Screening", kind: "new" }, source: "manual", applied_at: "2026-10-23T12:00:00Z", added_by: { id: personId, name: "María Equipo" } }],
};
export const publishedVacancy: DraftListRow = {
  id: vacancyId, title: "Plataforma real", status: "published", process: "active", candidates: { total: 99, in_process: 5, discarded: 2, by_stage: [] },
  work_mode: "remote", work_schedule: "full_time", principal_recruiter: { id: personId, name: "María Equipo" }, requester: null, version: "1", created_at: "2026-10-20T12:00:00Z", updated_at: "2026-10-23T12:00:00Z", published_at: "2026-10-20T12:00:00Z", paused_at: null, closed_at: null, close_reason: null, close_reason_note: null, process_finished_at: null,
};
