"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { toMetricsFailure } from "@/features/company-metrics/failure";
import type { MetricsFailure, MetricsResult } from "@/features/company-metrics/model";
import { getDashboardSection, listDashboard, type DashboardClientFailure } from "./client";
import type { DashboardListKind } from "./drilldown";
import { dashboardApiQuery, parseDashboardDetail } from "./detail/query";
import type { DashboardApplicationList, DashboardCandidateList, DashboardDeliveryList, DashboardVacancyList } from "./detail/model";
import {
  parseWindow, type AttentionSection, type DashboardSectionName, type DashboardWindow, type OriginSection, type PipelineSection,
  type RecentSection, type SummarySection, type VacanciesSection,
} from "./model";

const unauthenticated: MetricsFailure = { ok: false, reason: "unauthenticated", reference: {} };
const noResponse: MetricsFailure = { ok: false, reason: "no_response", reference: {} };

/** The metrics mapping (allowlisted codes only), plus the dashboard's existing rule: an inactive company (409) is restricted. */
function failure(result: DashboardClientFailure): MetricsFailure {
  const mapped = toMetricsFailure(result);
  return result.error.status === 409 ? { ...mapped, reason: "forbidden" } : mapped;
}

async function read<T>(section: DashboardSectionName, window: unknown): Promise<MetricsResult<T>> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const result = await getDashboardSection(token, section, parseWindow(window));
    return result.ok ? { ok: true, data: result.data as T } : failure(result);
  } catch { return noResponse; }
}

/** One action per section (contract §3), so each section loads, fails and retries on its own (rule 17). */
export async function loadSummaryAction(window?: DashboardWindow): Promise<MetricsResult<SummarySection>> { return read("summary", window); }
export async function loadAttentionAction(window?: DashboardWindow): Promise<MetricsResult<AttentionSection>> { return read("attention", window); }
export async function loadPipelineAction(window?: DashboardWindow): Promise<MetricsResult<PipelineSection>> { return read("pipeline", window); }
export async function loadVacanciesAction(window?: DashboardWindow): Promise<MetricsResult<VacanciesSection>> { return read("vacancies", window); }
export async function loadRecentAction(window?: DashboardWindow): Promise<MetricsResult<RecentSection>> { return read("recent", window); }
export async function loadOriginAction(window?: DashboardWindow): Promise<MetricsResult<OriginSection>> { return read("origin", window); }

/** Opaque cursors are short; anything longer never travels. */
const MAX_CURSOR_LENGTH = 2048;
type ListInput = { window: unknown; query: Record<string, string>; cursor?: string };
type ListPage<K extends DashboardListKind, P> = MetricsResult<{ kind: K; page: P }>;
/**
 * Contract §5: one page of a dashboard list. The query is validated again here (per kind, unknown keys dropped, the
 * window 7 | 30 | 90), so only a well-formed query reaches the API. Scope is the server's, from the session role.
 */
async function list<K extends DashboardListKind, P>(kind: K, { window, query, cursor }: ListInput): Promise<ListPage<K, P>> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    let state: ReturnType<typeof parseDashboardDetail> = null;
    try { state = parseDashboardDetail(new URLSearchParams({ ...query, kind, window: String(parseWindow(window)) })); } catch { state = null; }
    const validCursor = cursor === undefined || (typeof cursor === "string" && cursor.length > 0 && cursor.length <= MAX_CURSOR_LENGTH);
    if (!state || state.kind !== kind || !validCursor) return toMetricsFailure({ error: { kind: "invalid_request" } });
    const result = await listDashboard(token, kind, dashboardApiQuery(state), cursor);
    return result.ok ? { ok: true, data: result.data as { kind: K; page: P } } : failure(result);
  } catch { return noResponse; }
}
/** One Server Action per list (contract §5). */
export async function listDashboardCandidatesAction(input: ListInput): Promise<ListPage<"candidates", DashboardCandidateList>> { return list("candidates", input); }
export async function listDashboardDeliveriesAction(input: ListInput): Promise<ListPage<"deliveries", DashboardDeliveryList>> { return list("deliveries", input); }
export async function listDashboardVacanciesAction(input: ListInput): Promise<ListPage<"vacancies", DashboardVacancyList>> { return list("vacancies", input); }
export async function listDashboardApplicationsAction(input: ListInput): Promise<ListPage<"applications", DashboardApplicationList>> { return list("applications", input); }
