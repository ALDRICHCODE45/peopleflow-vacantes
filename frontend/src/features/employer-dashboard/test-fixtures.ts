import type {
  AttentionSection, DashboardHeader, OriginSection, PipelineSection, RecentRow, RecentSection, SummarySection, VacanciesSection,
} from "./model";

export const vacancyId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
export const personId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
export const secondVacancyId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90";
export const participationId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d91";
export const responsibleId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";

/** 8 nov 2026, 10:42 in Mexico City (UTC−6): a Sunday. */
export const asOf = "2026-11-08T16:42:00Z";
const DAY_MS = 86_400_000;
export const daysBefore = (to: string, count: number) => new Date(Date.parse(`${to}T00:00:00Z`) - count * DAY_MS).toISOString().slice(0, 10);

export function header(days: 7 | 30 | 90 = 30, scope: DashboardHeader["scope"] = "company"): DashboardHeader {
  const to = "2026-11-08";
  const from = daysBefore(to, days - 1);
  const previousTo = daysBefore(from, 1);
  return { definitions_version: "d2", window: { days, from, to, previous_from: daysBefore(previousTo, days - 1), previous_to: previousTo }, as_of: asOf, scope };
}

export function summary(days: 7 | 30 | 90 = 30, overrides: Partial<SummarySection> = {}): SummarySection {
  const base = header(days);
  // The previous window's last day, then every window day; 125 → 143 like artboard 09.
  const series = Array.from({ length: days + 1 }, (_, i) => ({ date: daysBefore(base.window.to, days - i), value: Math.round(125 + (18 * i) / days) }));
  return {
    ...base,
    in_process: { current: series[days].value, previous: series[0].value, series },
    published_vacancies: { current: 28, previous: 25 },
    pool_added: { current: 96, previous: 84 },
    positions: { covered: 19, required: 64 },
    ...overrides,
  };
}

export function emptySummary(days: 7 | 30 | 90 = 30): SummarySection {
  const base = summary(days);
  return {
    ...base,
    in_process: { current: 0, previous: 0, series: base.in_process.series.map(point => ({ ...point, value: 0 })) },
    published_vacancies: { current: 0, previous: 0 }, pool_added: { current: 0, previous: 0 }, positions: { covered: 0, required: 0 },
  };
}

const vacancy = (title: string, draft_id = vacancyId) => ({ draft_id, title });
const banorte = { kind: "client" as const, id: personId, name: "Banorte" };
const andres = { user_id: responsibleId, name: "Andrés Castillo", former_member: false };

export function attention(overrides: Partial<AttentionSection> = {}): AttentionSection {
  return {
    ...header(),
    overdue: {
      total: 6,
      top: [
        { vacancy: vacancy("Ejecutivo de cuenta"), requester: banorte, responsible: andres, commitment_date: "2026-10-30", business_days_overdue: 6, delivered: 2, target: 5 },
        { vacancy: vacancy("Jefe de mantenimiento", secondVacancyId), requester: null, responsible: null, commitment_date: "2026-11-04", business_days_overdue: 1, delivered: 2, target: 3 },
      ],
    },
    due_this_week: {
      total: 1,
      top: [{ vacancy: vacancy("Analista de crédito Sr."), requester: banorte, responsible: andres, commitment_date: "2026-11-08", delivered: 2, target: 4 }],
    },
    stalled: {
      total: 14, threshold_business_days: 7,
      top: [{ participation_id: participationId, candidate: { id: personId, full_name: "Héctor Salinas" }, vacancy: vacancy("Desarrollador backend Go"), stage: { kind: "in_process", name: "Evaluación" }, business_days_in_stage: 12 }],
    },
    ...overrides,
  };
}

export function emptyAttention(): AttentionSection {
  return { ...header(), overdue: { total: 0, top: [] }, due_this_week: { total: 0, top: [] }, stalled: { total: 0, threshold_business_days: 7, top: [] } };
}

export function pipeline(overrides: Partial<PipelineSection> = {}): PipelineSection {
  return {
    ...header(),
    stalled_threshold_business_days: 7,
    stages: [
      { kind: "new", candidates: 48, median_business_days_in_stage: 2, stalled: 2 },
      { kind: "screening", candidates: 31, median_business_days_in_stage: 4, stalled: 3 },
      { kind: "screening_ok", candidates: 0, median_business_days_in_stage: null, stalled: 0 },
      { kind: "in_process", candidates: 19, median_business_days_in_stage: 6, stalled: 7 },
      { kind: "custom", candidates: 36, median_business_days_in_stage: 3, stalled: 2 },
      { kind: "placement", candidates: 9, median_business_days_in_stage: 1, stalled: 0 },
    ],
    ...overrides,
  };
}

export function vacancies(overrides: Partial<VacanciesSection> = {}): VacanciesSection {
  return {
    ...header(),
    top: [
      { vacancy: vacancy("Analista de crédito Sr."), requester: banorte, responsible: andres, in_process: 14, positions: { covered: 1, required: 3 } },
      { vacancy: vacancy("Desarrollador backend Go", secondVacancyId), requester: { kind: "internal_area", id: null, name: null }, responsible: null, in_process: 0, positions: { covered: 0, required: 0 } },
    ],
    ...overrides,
  };
}

export const recentRows: RecentRow[] = [
  { participation_id: vacancyId, candidate: { kind: "organic", id: personId, name: "Ana Real", professional_title: "Ingeniera" }, vacancy: { id: vacancyId, title: "Plataforma real" }, stage: { id: personId, name: "Entrevista", kind: "in_process" }, source: "organic", applied_at: "2026-11-08T15:18:00Z", added_by: null },
  { participation_id: personId, candidate: { kind: "organic", id: personId, name: "Luis Real", professional_title: null }, vacancy: { id: vacancyId, title: "Plataforma real" }, stage: { id: personId, name: "Screening", kind: "new" }, source: "manual", applied_at: "2026-11-08T00:05:00Z", added_by: { id: personId, name: "María Equipo" } },
];

export function recent(overrides: Partial<RecentSection> = {}): RecentSection {
  return { ...header(), recent: recentRows, ...overrides };
}

export function origin(days: 7 | 30 | 90 = 30, overrides: Partial<OriginSection> = {}): OriginSection {
  const base = header(days);
  return {
    ...base,
    by_day: Array.from({ length: days }, (_, i) => ({ date: daysBefore(base.window.to, days - 1 - i), organic: (i % 3) + 1, manual: i % 2 })),
    ...overrides,
  };
}
