import { parsePipelineCandidates } from "./pipeline-model";
import type { PipelineCandidate } from "./pipeline-model";

/**
 * The fictional employer this workspace belongs to is Nexo Labs. Every candidate
 * card below is authored local demo content for the prototype pipeline: it is
 * validated at this module boundary and never fetched, persisted, or sent
 * anywhere.
 *
 * These cards are a representative subset of each vacancy's portfolio counters,
 * not their equal: every one of the six `NEXO_VACANCIES` routes gets at least one
 * card, and `backend-developer-senior` carries all four application statuses so
 * both board and list modes have faithful content.
 */
const NEXO_CANDIDATE_SOURCE: readonly PipelineCandidate[] = [
  {
    id: "lucia-fernandez", vacancyId: "backend-developer-senior", fullName: "Lucía Fernández",
    professionalTitle: "Backend Developer Senior", yearsOfExperience: 8, status: "submitted", source: "linkedin",
    receivedAt: "2026-03-10T09:15:00-06:00", lastActivityAt: "2026-03-10T09:15:00-06:00", owner: "Valeria Ortiz",
    skills: ["Node.js", "PostgreSQL"], matchScore: 88, commentCount: 0, nextStep: "Coordinar llamada inicial",
  },
  {
    id: "diego-salazar", vacancyId: "backend-developer-senior", fullName: "Diego Salazar",
    professionalTitle: "Ingeniero Backend", yearsOfExperience: 6, status: "in_review", source: "referral",
    receivedAt: "2026-03-08T11:40:00-06:00", lastActivityAt: "2026-03-12T16:20:00-06:00", owner: "Valeria Ortiz",
    skills: ["Go", "Kubernetes", "PostgreSQL"], matchScore: 91, commentCount: 4, nextStep: "Agendar entrevista técnica",
  },
  {
    id: "renata-vargas", vacancyId: "backend-developer-senior", fullName: "Renata Vargas",
    professionalTitle: "Arquitecta de Software", yearsOfExperience: 11, status: "hired", source: "direct",
    receivedAt: "2026-02-25T08:05:00-06:00", lastActivityAt: "2026-03-14T10:00:00-06:00", owner: "Valeria Ortiz",
    skills: ["Java", "Spring", "AWS"], matchScore: 95, commentCount: 7,
  },
  {
    id: "martin-bustos", vacancyId: "backend-developer-senior", fullName: "Martín Bustos",
    professionalTitle: "Desarrollador Backend", yearsOfExperience: 3, status: "rejected", source: "job_board",
    receivedAt: "2026-03-02T14:30:00-06:00", lastActivityAt: "2026-03-06T09:10:00-06:00", owner: "Valeria Ortiz",
    skills: ["PHP"], matchScore: 54, commentCount: 2, nextStep: "Comunicar decisión final",
  },
  {
    id: "sofia-medina", vacancyId: "frontend-engineer-react", fullName: "Sofía Medina",
    professionalTitle: "Frontend Engineer", yearsOfExperience: 5, status: "submitted", source: "direct",
    receivedAt: "2026-03-12T10:25:00-06:00", lastActivityAt: "2026-03-12T10:25:00-06:00", owner: "Mateo Ríos",
    skills: ["React", "TypeScript"], matchScore: 84, commentCount: 0, nextStep: "Revisar portfolio",
  },
  {
    id: "tomas-aguiar", vacancyId: "frontend-engineer-react", fullName: "Tomás Aguiar",
    professionalTitle: "Desarrollador Frontend", yearsOfExperience: 7, status: "in_review", source: "other",
    receivedAt: "2026-03-09T17:45:00-06:00", lastActivityAt: "2026-03-13T12:00:00-06:00", owner: "Mateo Ríos",
    skills: ["React", "Next.js", "Tailwind CSS", "Testing"], matchScore: 89, commentCount: 3, nextStep: "Prueba técnica asincrónica",
  },
  {
    id: "camila-rojas", vacancyId: "fullstack-developer", fullName: "Camila Rojas",
    professionalTitle: "Desarrolladora Fullstack", yearsOfExperience: 4, status: "in_review", source: "referral",
    receivedAt: "2026-03-11T13:10:00-06:00", lastActivityAt: "2026-03-13T15:30:00-06:00", owner: "Camila Duarte",
    skills: ["Node.js", "React"], matchScore: 78, commentCount: 2, nextStep: "Entrevista con el equipo",
  },
  {
    id: "paula-quintero", vacancyId: "devops-engineer", fullName: "Paula Quintero",
    professionalTitle: "Ingeniera DevOps", yearsOfExperience: 6, status: "submitted", source: "job_board",
    receivedAt: "2026-03-14T08:40:00-06:00", lastActivityAt: "2026-03-14T08:40:00-06:00", owner: "Valeria Ortiz",
    skills: ["Terraform", "AWS", "CI/CD"], matchScore: 82, commentCount: 0, nextStep: "Validar certificaciones",
  },
  {
    id: "hector-navarro", vacancyId: "qa-automation-engineer", fullName: "Héctor Navarro",
    professionalTitle: "Ingeniero de Automatización QA", yearsOfExperience: 5, status: "hired", source: "direct",
    receivedAt: "2026-01-28T10:05:00-06:00", lastActivityAt: "2026-02-20T09:00:00-06:00", owner: "Mateo Ríos",
    skills: ["Playwright", "TypeScript"], matchScore: 93, commentCount: 5,
  },
  {
    id: "ines-cordero", vacancyId: "data-analyst", fullName: "Inés Cordero",
    professionalTitle: "Analista de Datos", yearsOfExperience: 3, status: "hired", source: "linkedin",
    receivedAt: "2026-02-04T12:20:00-06:00", lastActivityAt: "2026-02-18T14:45:00-06:00", owner: "Camila Duarte",
    skills: ["SQL", "Python"], matchScore: 76, commentCount: 2, nextStep: "Revisar caso práctico",
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
 * The frozen Nexo Labs candidate set: validated by `parsePipelineCandidates` at
 * this module boundary, then deeply frozen so no later screen can mutate a card.
 */
export const NEXO_CANDIDATES: readonly PipelineCandidate[] = deepFreeze(
  parsePipelineCandidates(NEXO_CANDIDATE_SOURCE),
);
