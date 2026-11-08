import { applicationList, candidateList, clientId, deliveryListRow, draftId, jorge } from "@/features/company-metrics/test-fixtures";
import { header } from "../test-fixtures";
import type { DashboardApplicationList, DashboardCandidateList, DashboardDeliveryList, DashboardVacancyList, DashboardVacancyRow } from "./model";

/** Dashboard list pages (d2b): the dashboard header with the metrics §5 rows the board's figures open. */
export { draftId };
const listHeader = (days: 7 | 30 | 90 = 30) => header(days);

export function dashboardCandidates(overrides: Partial<DashboardCandidateList> = {}, days: 7 | 30 | 90 = 30): DashboardCandidateList {
  const { items, facets } = candidateList();
  return { ...listHeader(days), total: 2, facets, applied_filters: { in_process: true }, items, next_cursor: null, ...overrides };
}

export function dashboardDeliveries(overrides: Partial<DashboardDeliveryList> = {}): DashboardDeliveryList {
  return {
    ...listHeader(), total: 2, facets: { state: { overdue: 2, due_this_week: 3 } }, applied_filters: { state: "overdue" },
    items: [
      deliveryListRow({ result: "overdue", commitment_date: "2026-10-28", target_reached_at: null, business_days_late: null, business_days_overdue: 8, delivered: 2, target: 5, attributed_to: [jorge] }),
      deliveryListRow({ vacancy: { draft_id: "30000000-0000-4000-8000-000000000002", title: "Supervisor de turno" }, result: "overdue", commitment_date: "2026-11-04", target_reached_at: null,
        business_days_late: null, business_days_overdue: 2, delivered: 0, target: 3, attributed_to: [] }),
    ],
    next_cursor: null, ...overrides,
  };
}

export function dashboardVacancyRow(overrides: Partial<DashboardVacancyRow> = {}): DashboardVacancyRow {
  return {
    vacancy: { draft_id: draftId, title: "Analista de crédito Sr." }, requester: { kind: "client", id: clientId, name: "Grupo Bimbo" }, responsible: jorge,
    status: "published", published_at: "2026-09-14T16:00:00Z", in_process: 14, positions: { covered: 1, required: 3 }, ...overrides,
  };
}
export function dashboardVacancies(overrides: Partial<DashboardVacancyList> = {}): DashboardVacancyList {
  return {
    ...listHeader(), total: 2, facets: { status: { published: 2, paused: 1, closed: 4, finished: 0 } }, applied_filters: { status: "published" },
    items: [dashboardVacancyRow(), dashboardVacancyRow({ vacancy: { draft_id: "30000000-0000-4000-8000-000000000002", title: null }, requester: null, responsible: null, in_process: 0, positions: { covered: 2, required: 2 } })],
    next_cursor: null, ...overrides,
  };
}

export function dashboardApplications(overrides: Partial<DashboardApplicationList> = {}): DashboardApplicationList {
  const { items, facets } = applicationList();
  return { ...listHeader(), total: 154, facets, applied_filters: { channel: ["portal", "careers_site"] }, items, next_cursor: null, ...overrides };
}
