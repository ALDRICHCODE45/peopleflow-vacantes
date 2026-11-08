"use client";
import { ExportCsvButton } from "@/features/company-metrics/detail/export-button";
import { dashboardApiQuery, type DashboardDetailState } from "./query";

/** «Exportar CSV» of a dashboard list: the same validated query and window, posted to its fixed same-origin route. */
export function ExportDashboardButton({ state }: { state: DashboardDetailState }) {
  return <ExportCsvButton href={`/api/company/dashboard/${state.kind}/export?${dashboardApiQuery(state)}`} fallbackFile="dashboard.csv" />;
}
