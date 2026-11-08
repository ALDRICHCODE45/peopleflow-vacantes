"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { toMetricsFailure } from "@/features/company-metrics/failure";
import type { MetricsFailure, MetricsResult } from "@/features/company-metrics/model";
import { getDashboardSection, type DashboardClientFailure } from "./client";
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
