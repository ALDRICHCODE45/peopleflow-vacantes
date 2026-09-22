import { parseEmployerVacancies } from "./model";
import type { EmployerVacancy } from "./model";

/**
 * The fictional employer this workspace belongs to is Nexo Labs: a made-up
 * company. Every vacancy, recruiter, team size, and candidate count below is
 * authored demo content, validated at this module boundary, and never fetched,
 * persisted, or sent anywhere.
 *
 * The mix mirrors the committed `design/screens/vacantes-empresa.html` states:
 * active positions, one paused position, and closed positions.
 */
const NEXO_VACANCY_SOURCE: readonly EmployerVacancy[] = [
  {
    id: "backend-developer-senior",
    title: "Backend Developer (Senior)",
    workMode: "remote",
    employmentType: "full_time",
    state: "active",
    publishedAt: "2026-03-09T15:00:00Z",
    recruiter: "Valeria Ortiz",
    teamSize: 6,
    candidateCounts: { submitted: 3, in_review: 2, hired: 0, rejected: 1 },
  },
  {
    id: "frontend-engineer-react",
    title: "Frontend Engineer (React)",
    workMode: "hybrid",
    employmentType: "full_time",
    state: "active",
    publishedAt: "2026-03-11T09:30:00Z",
    recruiter: "Mateo Ríos",
    teamSize: 4,
    candidateCounts: { submitted: 6, in_review: 5, hired: 1, rejected: 3 },
  },
  {
    id: "fullstack-developer",
    title: "Fullstack Developer",
    workMode: "hybrid",
    employmentType: "full_time",
    state: "active",
    publishedAt: "2026-03-13T17:45:00Z",
    recruiter: "Camila Duarte",
    teamSize: 5,
    candidateCounts: { submitted: 4, in_review: 4, hired: 1, rejected: 2 },
  },
  {
    id: "devops-engineer",
    title: "DevOps Engineer",
    workMode: "remote",
    employmentType: "full_time",
    state: "paused",
    publishedAt: "2026-02-24T13:15:00Z",
    recruiter: "Valeria Ortiz",
    teamSize: 3,
    candidateCounts: { submitted: 2, in_review: 3, hired: 0, rejected: 1 },
  },
  {
    id: "qa-automation-engineer",
    title: "QA Automation Engineer",
    workMode: "onsite",
    employmentType: "full_time",
    state: "closed",
    publishedAt: "2026-01-20T16:00:00Z",
    recruiter: "Mateo Ríos",
    teamSize: 2,
    candidateCounts: { submitted: 0, in_review: 0, hired: 4, rejected: 5 },
  },
  {
    id: "data-analyst",
    title: "Data Analyst",
    workMode: "hybrid",
    employmentType: "contract",
    state: "closed",
    publishedAt: "2026-02-02T11:00:00Z",
    recruiter: "Camila Duarte",
    teamSize: 2,
    candidateCounts: { submitted: 1, in_review: 0, hired: 2, rejected: 1 },
  },
];

/** Freezes a value and every plain object reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * The frozen Nexo Labs portfolio: validated by `parseEmployerVacancies` at this
 * module boundary, then deeply frozen so no later screen can mutate a fixture.
 */
export const NEXO_VACANCIES: readonly EmployerVacancy[] = deepFreeze(parseEmployerVacancies(NEXO_VACANCY_SOURCE));
