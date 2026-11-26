import type { MarkResult, NotificationFacets, NotificationGroup, NotificationPage } from "./model";

export const jobId = "40000000-0000-4000-8000-000000000001";
export const otherJobId = "40000000-0000-4000-8000-000000000002";
export const anaParticipation = "70000000-0000-4000-8000-000000000001";
export const luisParticipation = "70000000-0000-4000-8000-000000000002";
export const carmenId = "10000000-0000-4000-8000-000000000004";
export const olgaId = "10000000-0000-4000-8000-000000000005";

/** Group of `GET /v2/me/company/notifications` (contract notifications-v1 §GET B example). */
export function applicationsGroup(overrides: Partial<NotificationGroup> = {}): NotificationGroup {
  return {
    group_key: `applications:${jobId}:2026-11-26`,
    type: "application_received",
    kind: "operational",
    urgency: "normal",
    count: 5,
    unread_count: 3,
    read: false,
    resolved: false,
    latest_at: "2026-11-26T18:41:10Z",
    first_at: "2026-11-26T15:02:44Z",
    job: { id: jobId, title: "Analista de nómina" },
    latest: { id: "01937c90-0000-7000-8000-000000000001", created_at: "2026-11-26T18:41:10Z", actor: null, payload: {} },
    sample: [
      { participation_id: anaParticipation, name: "Ana López" },
      { participation_id: luisParticipation, name: null },
    ],
    link: { kind: "vacancy_candidates", job_id: jobId },
    ...overrides,
  };
}

export function overdueGroup(overrides: Partial<NotificationGroup> = {}): NotificationGroup {
  return {
    group_key: "n:01937b2e-6b1a-7c2e-9f10-0a1b2c3d4e5f",
    type: "delivery_overdue",
    kind: "mandatory",
    urgency: "overdue",
    count: 1,
    unread_count: 1,
    read: false,
    resolved: false,
    latest_at: "2026-11-26T12:00:03Z",
    first_at: "2026-11-26T12:00:03Z",
    job: { id: jobId, title: "Analista de nómina" },
    latest: { id: "01937b2e-6b1a-7c2e-9f10-0a1b2c3d4e5f", created_at: "2026-11-26T12:00:03Z", actor: null, payload: { commitment_date: "2026-11-25" } },
    sample: [],
    link: { kind: "vacancy_delivery", job_id: jobId },
    ...overrides,
  };
}

export function reassignedGroup(overrides: Partial<NotificationGroup> = {}): NotificationGroup {
  return {
    group_key: "n:01937a11-0000-7000-8000-000000000001",
    type: "vacancy_reassigned",
    kind: "mandatory",
    urgency: "normal",
    count: 1,
    unread_count: 0,
    read: true,
    resolved: false,
    latest_at: "2026-11-26T10:15:00Z",
    first_at: "2026-11-26T10:15:00Z",
    job: { id: otherJobId, title: "Ejecutivo de ventas" },
    latest: {
      id: "01937a11-0000-7000-8000-000000000001", created_at: "2026-11-26T10:15:00Z",
      actor: { user_id: olgaId, name: "Olga Owner" }, payload: { reason: "workload", from_user_id: carmenId },
    },
    sample: [],
    link: { kind: "vacancy", job_id: otherJobId },
    from_user: { user_id: carmenId, name: "Carmen Colleague" },
    ...overrides,
  };
}

/** Response of `POST …/read`, `…/unread` and `…/read-all` (contract §POST B/read). */
export function markResult(overrides: Partial<MarkResult> = {}): MarkResult {
  return {
    affected_notifications: 3,
    affected_groups: 1,
    marked_at: "2026-11-26T18:45:02.123456Z",
    unread_count: 3,
    unread_notifications: 3,
    ...overrides,
  };
}

/** Response of `GET …/facets` (contract §GET B/facets). */
export function notificationFacets(overrides: Partial<NotificationFacets> = {}): NotificationFacets {
  return {
    state: "unread",
    types: [{ type: "application_received", count: 2 }, { type: "delivery_overdue", count: 1 }],
    jobs: [{ job_id: jobId, title: "Analista de nómina", count: 3 }, { job_id: otherJobId, title: null, count: 1 }],
    jobs_total: 2,
    ...overrides,
  };
}

export function notificationPage(overrides: Partial<NotificationPage> = {}): NotificationPage {
  return {
    attention: [overdueGroup()],
    attention_total: 1,
    items: [applicationsGroup(), reassignedGroup()],
    next_cursor: null,
    unread_count: 2,
    unread_notifications: 4,
    ...overrides,
  };
}

export const companyId = "50000000-0000-4000-8000-000000000001";
export const invitationId = "80000000-0000-4000-8000-000000000001";

/** Item of `GET /v2/me/notifications` (L14): one per notification, company resolved, no actor, no sample, no attention. */
export function candidateGroup(overrides: Partial<NotificationGroup> = {}): NotificationGroup {
  return {
    group_key: "n:01937d00-0000-7000-8000-000000000001",
    type: "candidate_status_changed",
    kind: "operational",
    urgency: "normal",
    count: 1,
    unread_count: 1,
    read: false,
    resolved: false,
    latest_at: "2026-11-26T18:30:00Z",
    first_at: "2026-11-26T18:30:00Z",
    job: { id: jobId, title: "Analista de nómina" },
    latest: { id: "01937d00-0000-7000-8000-000000000001", created_at: "2026-11-26T18:30:00Z", actor: null, payload: { status: "in_process" } },
    sample: [],
    link: { kind: "application", job_id: jobId, participation_id: anaParticipation },
    company: { id: companyId, name: "Grupo Altavista" },
    ...overrides,
  };
}

export function candidatePage(overrides: Partial<NotificationPage> = {}): NotificationPage {
  return {
    attention: [],
    attention_total: 0,
    items: [
      candidateGroup({
        group_key: "n:01937d00-0000-7000-8000-000000000002", type: "candidate_message_received",
        latest: { id: "01937d00-0000-7000-8000-000000000002", created_at: "2026-11-26T18:40:00Z", actor: null, payload: { status: "closed" } },
        latest_at: "2026-11-26T18:40:00Z", first_at: "2026-11-26T18:40:00Z",
      }),
      candidateGroup(),
      candidateGroup({
        group_key: "n:01937d00-0000-7000-8000-000000000003", type: "candidate_test_pending", read: true, unread_count: 0,
        latest: { id: "01937d00-0000-7000-8000-000000000003", created_at: "2026-11-26T15:00:00Z", actor: null, payload: { invitation_id: invitationId } },
        latest_at: "2026-11-26T15:00:00Z", first_at: "2026-11-26T15:00:00Z",
        link: { kind: "assessment", invitation_id: invitationId },
      }),
    ],
    next_cursor: null,
    unread_count: 2,
    unread_notifications: 2,
    ...overrides,
  };
}
