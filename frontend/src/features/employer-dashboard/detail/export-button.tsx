"use client";
import { ExportCsvButton } from "@/features/company-metrics/detail/export-button";
import { dashboardApiQuery, type DashboardDetailState } from "./query";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The backend names every export after the window (`dashboard-{kind}-{from}-{to}.csv`); a chart point narrows the list to
 * its own day or days, so its file says those instead. Null keeps the backend's name.
 */
export function pointFile({ kind, params }: DashboardDetailState): string | null {
  const days = kind === "applications" ? [params.from ?? params.to, params.to ?? params.from] : kind === "candidates" ? [params.on] : [];
  const valid = days.filter((day): day is string => Boolean(day && DAY.test(day)));
  if (valid.length === 0) return null;
  const unique = valid.length === 2 && valid[0] === valid[1] ? [valid[0]] : valid;
  return `dashboard-${kind}-${unique.join("-")}.csv`;
}

/** «Exportar CSV» of a dashboard list: the same validated query and window, posted to its fixed same-origin route. */
export function ExportDashboardButton({ state }: { state: DashboardDetailState }) {
  return <ExportCsvButton href={`/api/company/dashboard/${state.kind}/export?${dashboardApiQuery(state)}`} fallbackFile="dashboard.csv" file={pointFile(state) ?? undefined} />;
}
