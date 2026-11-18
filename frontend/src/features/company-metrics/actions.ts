"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import {
  getClosures, getCompanyAccess, getCompliance, getDelays, getDeliveries, getOrigin, getPipeline, getPlacements, getRecruiter, getSummary, listReassignments,
  listRecruiters, listVacancies, type MetricsClientFailure,
  invalidRequest, listDetail,
} from "./client";
import { detailApiQuery, isListKind, parseDetail } from "./detail/query";
import { toMetricsFailure } from "./failure";
import {
  metricsAllowed, type ClosuresSection, type ComplianceSection, type DelaysSection, type OriginSection, type PipelineSection, type DeliveriesDetail, type MetricsAccess, type MetricsFailure, type MetricsResult, type MetricsSummary,
  type DetailPage, type PlacementsDetail, type ReassignmentPage, type RecruiterCard, type RecruiterDetail, type VacancyPage,
} from "./model";
import { mexicoToday } from "./period";
import { apiQuery, effectivePeriod, type MetricsFilters } from "./url-state";

const unauthenticated: MetricsFailure = { ok: false, reason: "unauthenticated", reference: {} };
const noResponse: MetricsFailure = { ok: false, reason: "no_response", reference: {} };
/** Recruiter cards are company scale (tens); the cap only stops a runaway cursor. */
const MAX_RECRUITER_PAGES = 20;

async function withToken<T>(run: (token: string) => Promise<T | MetricsFailure>): Promise<T | MetricsFailure> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    return await run(token);
  } catch { return noResponse; }
}

/** The page decides from the membership role before reading any metric; the API gate stays the authority (§1.2). */
export async function loadMetricsAccessAction(): Promise<MetricsAccess> {
  return withToken(async token => {
    const result = await getCompanyAccess(token);
    if (result.ok) return metricsAllowed(result.data.role) ? { kind: "allowed", role: result.data.role } : { kind: "restricted" };
    const failure = toMetricsFailure(result);
    return failure.reason === "not_found" || failure.reason === "forbidden" ? { kind: "restricted" } : failure;
  });
}

/** Every recruiter card of the period: the table sorts the whole set, so all pages are read. */
async function readRecruiters(token: string, query: URLSearchParams): Promise<MetricsResult<RecruiterCard[]>> {
  const items: RecruiterCard[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_RECRUITER_PAGES; page += 1) {
    const result = await listRecruiters(token, query, cursor);
    if (!result.ok) return toMetricsFailure(result);
    items.push(...result.data.items);
    if (!result.data.next_cursor) break;
    cursor = result.data.next_cursor;
  }
  return { ok: true, data: items };
}

export type Overview = { summary: MetricsSummary; recruiters: RecruiterCard[] };
/** Summary and every recruiter card of the period (v1 board; the v2 board loads each section on its own). */
export async function loadOverviewAction(filters: MetricsFilters): Promise<MetricsResult<Overview>> {
  return withToken(async token => {
    const query = apiQuery(filters, mexicoToday());
    const [summary, recruiters] = await Promise.all([getSummary(token, query), readRecruiters(token, query)]);
    if (!summary.ok) return toMetricsFailure(summary);
    if (!recruiters.ok) return recruiters;
    return { ok: true, data: { summary: summary.data, recruiters: recruiters.data } };
  });
}

type SectionRead<T> = (token: string, query: URLSearchParams) => Promise<{ ok: true; data: T } | MetricsClientFailure>;
const section = <T>(read: SectionRead<T>) => (filters: MetricsFilters): Promise<MetricsResult<T>> => withToken(async token => {
  const result = await read(token, apiQuery(filters, mexicoToday()));
  return result.ok ? result : toMetricsFailure(result);
});
/** v2 §4: one action per board section, so each section loads, fails and retries on its own. */
export async function loadSummaryAction(filters: MetricsFilters): Promise<MetricsResult<MetricsSummary>> { return section(getSummary)(filters); }
export async function loadClosuresAction(filters: MetricsFilters): Promise<MetricsResult<ClosuresSection>> { return section(getClosures)(filters); }
export async function loadComplianceAction(filters: MetricsFilters): Promise<MetricsResult<ComplianceSection>> { return section(getCompliance)(filters); }
export async function loadPipelineAction(filters: MetricsFilters): Promise<MetricsResult<PipelineSection>> { return section(getPipeline)(filters); }
export async function loadDelaysAction(filters: MetricsFilters): Promise<MetricsResult<DelaysSection>> { return section(getDelays)(filters); }
export async function loadOriginAction(filters: MetricsFilters): Promise<MetricsResult<OriginSection>> { return section(getOrigin)(filters); }
export async function loadRecruitersAction(filters: MetricsFilters): Promise<MetricsResult<RecruiterCard[]>> {
  return withToken(token => readRecruiters(token, apiQuery(filters, mexicoToday())));
}

type ListInput = { filters: MetricsFilters; cursor?: string };
export async function listVacanciesAction({ filters, cursor }: ListInput): Promise<MetricsResult<VacancyPage>> {
  return withToken(async token => {
    const result = await listVacancies(token, apiQuery(filters, mexicoToday()), cursor);
    return result.ok ? result : toMetricsFailure(result);
  });
}
export async function listReassignmentsAction({ filters, cursor }: ListInput): Promise<MetricsResult<ReassignmentPage>> {
  return withToken(async token => {
    const result = await listReassignments(token, apiQuery(filters, mexicoToday()), cursor);
    return result.ok ? result : toMetricsFailure(result);
  });
}

export async function loadRecruiterAction({ userId, filters }: { userId: string; filters: MetricsFilters }): Promise<MetricsResult<RecruiterDetail>> {
  return withToken(async token => {
    const result = await getRecruiter(token, userId, apiQuery(filters, mexicoToday()));
    return result.ok ? result : toMetricsFailure(result);
  });
}

export type AuditedReport = "deliveries" | "placements";
export type AuditedDetail = { report: "deliveries"; items: DeliveriesDetail["items"] } | { report: "placements"; items: PlacementsDetail["items"] };
/**
 * Candidate names only after the API recorded the read; any failure answers without names (fail closed). The period is
 * the one the summary reads (the URL one when valid, else the default).
 */
export async function loadAuditedDetailAction({ report, draftId, period }: { report: AuditedReport; draftId: string; period: Pick<MetricsFilters, "from" | "to"> }): Promise<MetricsResult<AuditedDetail>> {
  return withToken(async token => {
    const applied = effectivePeriod(period, mexicoToday());
    if (report === "deliveries") {
      const result = await getDeliveries(token, draftId, applied);
      return result.ok ? { ok: true, data: { report, items: result.data.items } } : toMetricsFailure(result);
    }
    const result = await getPlacements(token, draftId, applied);
    return result.ok ? { ok: true, data: { report, items: result.data.items } } : toMetricsFailure(result);
  });
}

/** Opaque cursors are short; anything longer than this never travels. */
const MAX_CURSOR_LENGTH = 2048;
/**
 * v2 §5: one page of the detail list. The page's query is validated again here (per kind, unknown keys dropped), so
 * only a well-formed query reaches the API; an unknown kind answers not found without a request.
 */
export async function loadDetailAction({ kind, query, cursor }: { kind: string; query: Record<string, string>; cursor?: string }): Promise<MetricsResult<DetailPage>> {
  return withToken(async token => {
    let state: ReturnType<typeof parseDetail> = null;
    try { state = parseDetail(new URLSearchParams({ ...query, kind })); } catch { state = null; }
    const validCursor = cursor === undefined || (typeof cursor === "string" && cursor.length > 0 && cursor.length <= MAX_CURSOR_LENGTH);
    if (!state || !isListKind(state.kind) || !validCursor) return toMetricsFailure(invalidRequest);
    const result = await listDetail(token, state.kind, detailApiQuery(state, mexicoToday()), cursor);
    return result.ok ? result : toMetricsFailure(result);
  });
}
