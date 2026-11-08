import type {
  ClosuresSection, ComplianceSection, DelaysSection, OriginSection,
  DeliveriesDetail, MetricsSummary, PlacementsDetail, ReassignmentPage, RecruiterCard, RecruiterDetail, RecruiterPage, VacancyPage, VacancyRow,
} from "./model";

export const marianaId = "10000000-0000-4000-8000-000000000001";
export const carlosId = "10000000-0000-4000-8000-000000000002";
export const fernandaId = "10000000-0000-4000-8000-000000000003";
export const andreaId = "10000000-0000-4000-8000-000000000004";
export const clientId = "20000000-0000-4000-8000-000000000001";
export const draftId = "30000000-0000-4000-8000-000000000001";
export const period = { from: "2026-08-01", to: "2026-10-31", time_zone: "America/Mexico_City" };

/** `GET …/metrics/summary`, the contract §3.1 example with a dense three-month series. */
export function summary(overrides: Partial<MetricsSummary> = {}): MetricsSummary {
  return {
    definitions_version: "v1", period,
    vacancies: { assigned: 42, closed: { filled: 18, cancelled: 4, other: 1, no_reason: 0 }, median_business_days_to_close: 23, closing_target: { on_time: 0, late: 0, no_target: 18 } },
    delivery: {
      on_time: 20, late: 7, overdue: 3, pending: 9, not_configured: 3, configured: 39, total: 42,
      on_time_rate: { value: 0.6667, numerator: 20, denominator: 30 },
      configured_rate: { value: 0.9286, numerator: 39, denominator: 42 },
      median_business_days_to_target: 11, delivered: 214,
    },
    placements: { credits: 25, did_not_hold: 2, positions_covered: 23, positions_required: 31 },
    origin: { portal: 120, careers_site: 34, manual: 61, unknown: 300 },
    closed_by_month: [
      { month: "2026-08", filled: 5, cancelled: 1, other: 0, no_reason: 0 },
      { month: "2026-09", filled: 6, cancelled: 2, other: 1, no_reason: 0 },
      { month: "2026-10", filled: 7, cancelled: 1, other: 0, no_reason: 0 },
    ],
    reassignments: { total: 6, by_reason: { workload: 2, recruiter_departure: 3, performance: 0, client_request: 1, other: 0 } },
    by_requester: [
      { requester: { kind: "client", id: clientId, name: "Grupo Bimbo" }, vacancies: 9, filled: 4 },
      { requester: { kind: "client", id: null, name: null }, vacancies: 2, filled: 0 },
      { requester: null, vacancies: 3, filled: 1 },
    ],
    ...overrides,
  };
}

/** A company summary for a period with no activity: counts are 0, medians and rates have no sample. */
export function emptySummary(): MetricsSummary {
  return summary({
    vacancies: { assigned: 0, closed: { filled: 0, cancelled: 0, other: 0, no_reason: 0 }, median_business_days_to_close: null, closing_target: { on_time: 0, late: 0, no_target: 0 } },
    delivery: {
      on_time: 0, late: 0, overdue: 0, pending: 0, not_configured: 0, configured: 0, total: 0,
      on_time_rate: { value: null, numerator: 0, denominator: 0 }, configured_rate: { value: null, numerator: 0, denominator: 0 },
      median_business_days_to_target: null, delivered: 0,
    },
    placements: { credits: 0, did_not_hold: 0, positions_covered: 0, positions_required: 0 },
    origin: { portal: 0, careers_site: 0, manual: 0, unknown: 0 },
    closed_by_month: [{ month: "2026-08", filled: 0, cancelled: 0, other: 0, no_reason: 0 }],
    reassignments: { total: 0, by_reason: { workload: 0, recruiter_departure: 0, performance: 0, client_request: 0, other: 0 } },
    by_requester: [],
  });
}

/** One card of `GET …/metrics/recruiters` (§3.2). */
export function card(overrides: Partial<RecruiterCard> = {}): RecruiterCard {
  return {
    user_id: marianaId, name: "Mariana Torres", former_member: false,
    vacancies: { assigned: 11, as_responsible: 8, as_collaborator: 2, as_member: 3, started_in_period: 5 },
    delivery: { on_time: 6, late: 1, overdue: 1, median_business_days_to_target: 10, delivered_in_tramo: 61 },
    placements: { direct: 6, participant: 1, shared: 2, did_not_hold: 0, closed_assigned: 8, conversion: { value: 0.75, numerator: 6, denominator: 8 } },
    reassignments: { received: 2, lost: 1 },
    business_days_in_tramos: 201,
    ...overrides,
  };
}
export const carlos = () => card({
  user_id: carlosId, name: "Carlos Mendoza Ruiz", former_member: true,
  vacancies: { assigned: 6, as_responsible: 5, as_collaborator: 1, as_member: 0, started_in_period: 1 },
  delivery: { on_time: 2, late: 2, overdue: 1, median_business_days_to_target: 14, delivered_in_tramo: 22 },
  // did_not_hold is part of direct + participant, never added on top: 3 placements, one of them did not hold.
  placements: { direct: 2, participant: 1, shared: 0, did_not_hold: 1, closed_assigned: 4, conversion: { value: 0.5, numerator: 2, denominator: 4 } },
  reassignments: { received: 0, lost: 3 }, business_days_in_tramos: 41,
});
export const fernanda = () => card({
  user_id: fernandaId, name: "Fernanda Ortiz",
  vacancies: { assigned: 2, as_responsible: 1, as_collaborator: 1, as_member: 0, started_in_period: 2 },
  delivery: { on_time: 0, late: 0, overdue: 0, median_business_days_to_target: null, delivered_in_tramo: 3 },
  placements: { direct: 0, participant: 0, shared: 0, did_not_hold: 0, closed_assigned: 0, conversion: { value: null, numerator: 0, denominator: 0 } },
  reassignments: { received: 1, lost: 0 }, business_days_in_tramos: 18,
});
export const andrea = () => card({
  user_id: andreaId, name: "Andrea Villalobos",
  vacancies: { assigned: 9, as_responsible: 7, as_collaborator: 2, as_member: 0, started_in_period: 4 },
  delivery: { on_time: 6, late: 1, overdue: 0, median_business_days_to_target: 9, delivered_in_tramo: 48 },
  placements: { direct: 5, participant: 1, shared: 0, did_not_hold: 0, closed_assigned: 6, conversion: { value: 0.8333, numerator: 5, denominator: 6 } },
  reassignments: { received: 1, lost: 0 }, business_days_in_tramos: 168,
});

/** Backend order (§3.7.11): lowercase name, null names last. */
export function recruiterPage(items: RecruiterCard[] = [andrea(), carlos(), fernanda(), card()], next_cursor: string | null = null): RecruiterPage {
  return { definitions_version: "v1", period, items, next_cursor };
}

/** `GET …/metrics/recruiters/{userId}` (§3.3): the card plus the dense monthly series. */
export function recruiterDetail(overrides: Partial<RecruiterDetail> = {}): RecruiterDetail {
  return {
    definitions_version: "v1", period, ...card(),
    by_month: [
      { month: "2026-08", assigned: 6, delivery: { on_time: 1, late: 1, overdue: 0 }, placements: 2 },
      { month: "2026-09", assigned: 7, delivery: { on_time: 3, late: 0, overdue: 0 }, placements: 3 },
      { month: "2026-10", assigned: 8, delivery: { on_time: 2, late: 0, overdue: 1 }, placements: 0 },
    ],
    ...overrides,
  };
}

export function vacancyRow(overrides: Partial<VacancyRow> = {}): VacancyRow {
  return {
    draft_id: draftId, title: "Supervisor de Producción",
    requester: { kind: "client", id: clientId, name: "Grupo Bimbo" },
    responsible: { user_id: marianaId, name: "Mariana Torres", former_member: false },
    first_published_at: "2026-08-04T16:00:00Z",
    closes: [{ date: "2026-09-15", reason: "filled" }],
    delivery: { result: "late", target: 6, delivered: 7, target_reached_at: "2026-08-28T23:35:00Z", commitment_date: "2026-08-26", original_commitment_date: "2026-08-19", renegotiations: 1, business_days_late: 2 },
    placements: { covered: 2, required: 2 },
    reassignments: 1,
    ...overrides,
  };
}
export function vacancyPage(items: VacancyRow[] = [vacancyRow()], next_cursor: string | null = null): VacancyPage {
  return { definitions_version: "v1", period, items, next_cursor };
}

export function reassignmentPage(next_cursor: string | null = null): ReassignmentPage {
  return {
    definitions_version: "v1", period, next_cursor,
    items: [{
      id: "40000000-0000-4000-8000-000000000001", performed_at: "2026-09-02T17:00:00Z",
      vacancy: { draft_id: draftId, title: "Supervisor de Producción" },
      from: { user_id: carlosId, name: "Carlos Mendoza Ruiz", former_member: true },
      to: { user_id: marianaId, name: "Mariana Torres", former_member: false },
      reason: "recruiter_departure", note: null,
      performed_by: { user_id: andreaId, name: "Andrea Villalobos", former_member: false },
      outgoing_tramo_business_days: 21,
    }],
  };
}

export function deliveries(): DeliveriesDetail {
  return {
    items: [
      { candidate: { id: "50000000-0000-4000-8000-000000000001", full_name: "Luis Ángel Ramírez Soto" }, reached_at: "2026-08-12T17:20:00Z", delivered_by: { user_id: marianaId, name: "Mariana Torres", former_member: false } },
      { candidate: { id: "50000000-0000-4000-8000-000000000002", full_name: "José Manuel Cárdenas Ruiz" }, reached_at: "2026-08-19T15:42:00Z", delivered_by: { user_id: carlosId, name: "Carlos Mendoza Ruiz", former_member: true } },
      { candidate: { id: "50000000-0000-4000-8000-000000000003", full_name: "Karla Ivonne Medina" }, reached_at: "2026-08-22T19:10:00Z", delivered_by: null },
    ],
  };
}

export function placements(): PlacementsDetail {
  return {
    items: [
      { candidate: { id: "50000000-0000-4000-8000-000000000004", full_name: "Brenda Sánchez Villegas" }, hired_at: "2026-09-10T17:00:00Z", status: "active", recipients: [{ person: { user_id: marianaId, name: "Mariana Torres", former_member: false }, kind: "direct" }] },
      { candidate: { id: "50000000-0000-4000-8000-000000000005", full_name: "Óscar Gutiérrez Pineda" }, hired_at: "2026-09-12T17:00:00Z", status: "did_not_hold", recipients: [{ person: { user_id: carlosId, name: "Carlos Mendoza Ruiz", former_member: true }, kind: "participant" }] },
    ],
  };
}

/** The v2 header every route sends since stakeholder-metrics v2 §3: `definitions_version`, `period`, `as_of`. */
export const asOf = "2026-11-08T19:40:12Z";
const v2Header = { definitions_version: "v2", period, as_of: asOf };

/** `GET …/metrics/summary` under v2 §4.1: the v1 fields plus the previous period, headline (N1) and monthly on-time (N2). */
export function summaryV2(overrides: Partial<MetricsSummary> = {}): MetricsSummary {
  return summary({
    ...v2Header,
    previous_period: { from: "2026-05-02", to: "2026-07-31" },
    headline: {
      on_time_rate: { current: { value: 0.6667, numerator: 20, denominator: 30 }, previous: { value: 0.5, numerator: 10, denominator: 20 } },
      assigned: { current: 42, previous: 38 },
      median_business_days_to_close: { current: 23, previous: 27 },
      placements: { current: 25, previous: 19 },
      reassignments: { current: 6, previous: 9 },
    },
    on_time_by_month: [
      { month: "2026-08", rate: { value: 0.6, numerator: 6, denominator: 10 } },
      { month: "2026-09", rate: { value: 0.7, numerator: 7, denominator: 10 } },
      { month: "2026-10", rate: { value: 0.7, numerator: 7, denominator: 10 } },
    ],
    ...overrides,
  });
}

/** §4.2: distinct vacancies closed per month (the reasons add up to `closed`) and the delivery status split. */
export function closures(overrides: Partial<ClosuresSection> = {}): ClosuresSection {
  return {
    ...v2Header,
    closed_by_month: [
      { month: "2026-08", closed: 6, filled: 5, cancelled: 1, other: 0, no_reason: 0 },
      { month: "2026-09", closed: 9, filled: 6, cancelled: 2, other: 1, no_reason: 0 },
      { month: "2026-10", closed: 8, filled: 7, cancelled: 1, other: 0, no_reason: 0 },
    ],
    delivery_status: { on_time: 20, late: 7, overdue: 3, pending: 9, not_configured: 3 },
    ...overrides,
  };
}

/** §4.3: late deliveries by business days late (they add up to `late` = 7) and the monthly on-time rate. */
export function compliance(overrides: Partial<ComplianceSection> = {}): ComplianceSection {
  return { ...v2Header, late_buckets: { up_to_2: 3, from_3_to_5: 2, over_5: 2 }, on_time_by_month: summaryV2().on_time_by_month!, ...overrides };
}

/** §4.5: closing target of filled closes, the overdue top (N4) and reassignments by reason. */
export function delays(overrides: Partial<DelaysSection> = {}): DelaysSection {
  return {
    ...v2Header,
    closing_target: { on_time: 9, late: 5, no_target: 4 },
    overdue: {
      total: 3,
      top: [
        { vacancy: { draft_id: draftId, title: "Ejecutivo de cuenta" }, commitment_date: "2026-10-20", business_days_overdue: 13, delivered: 2, target: 5,
          requester: { kind: "client", id: clientId, name: "Grupo Bimbo" }, attributed_to: [{ user_id: marianaId, name: "Mariana Torres", former_member: false }] },
        { vacancy: { draft_id: "30000000-0000-4000-8000-000000000002", title: null }, commitment_date: "2026-10-28", business_days_overdue: 8, delivered: 0, target: 3 },
      ],
    },
    reassignments_by_reason: { workload: 2, recruiter_departure: 3, performance: 0, client_request: 1, other: 0 },
    ...overrides,
  };
}

/** §4.6 origin: applications by channel in the period. */
export function origin(overrides: Partial<OriginSection> = {}): OriginSection {
  return { ...v2Header, by_channel: { portal: 120, careers_site: 34, manual: 61, unknown: 300 }, ...overrides };
}
