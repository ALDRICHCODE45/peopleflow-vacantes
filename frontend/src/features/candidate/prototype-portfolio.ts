import { candidateApplicationViewsSchema, candidateCvsSchema } from "./portfolio-model";
import type { CandidateApplicationView, CandidateCv } from "./portfolio-model";

/**
 * Fictional portfolio fixtures for `/candidato/postulaciones` and `/candidato/cvs`. Only the two pinned public
 * job identities are copied so their links resolve; other applications are honest historical entries with
 * `publicJobHref: null`. No public/employer fixture module is imported, and nothing is fetched or persisted.
 */
const APPLICATION_SOURCE: readonly CandidateApplicationView[] = [
  {
    id: "7b1c2d3e-4f50-4a1b-8c2d-3e4f5a6b7c01",
    jobId: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92",
    companyId: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93",
    jobTitle: "Desarrolladora Go",
    companyName: "Acme",
    coverLetter: null,
    status: "submitted",
    source: "linkedin",
    createdAt: "2026-03-05T12:30:00-06:00",
    updatedAt: "2026-03-05T12:30:00-06:00",
    publicJobHref: "/vacantes/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92",
  },
  {
    id: "7b1c2d3e-4f50-4a1b-8c2d-3e4f5a6b7c02",
    jobId: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
    companyId: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f",
    jobTitle: "Ingeniera Frontend",
    companyName: "Acme",
    coverLetter: "Me entusiasma construir interfaces accesibles para productos financieros.",
    status: "in_review",
    source: "referral",
    createdAt: "2026-02-20T10:00:00-06:00",
    updatedAt: "2026-03-01T09:15:00-06:00",
    publicJobHref: "/vacantes/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  },
  {
    id: "7b1c2d3e-4f50-4a1b-8c2d-3e4f5a6b7c03",
    jobId: "8c2d3e4f-5a60-4b2c-9d3e-4f5a6b7c8d10",
    companyId: "8c2d3e4f-5a60-4b2c-9d3e-4f5a6b7c8d11",
    jobTitle: "Analista de Datos",
    companyName: "Nébula Labs",
    coverLetter: "Adjunto mi experiencia analizando métricas de producto y salud.",
    status: "hired",
    source: "job_board",
    createdAt: "2025-11-02T08:45:00-06:00",
    updatedAt: "2026-01-15T17:20:00-06:00",
    publicJobHref: null,
  },
  {
    id: "7b1c2d3e-4f50-4a1b-8c2d-3e4f5a6b7c04",
    jobId: "8c2d3e4f-5a60-4b2c-9d3e-4f5a6b7c8d12",
    companyId: "8c2d3e4f-5a60-4b2c-9d3e-4f5a6b7c8d13",
    jobTitle: "Diseñadora UX",
    companyName: "Estudio Prisma",
    coverLetter: null,
    status: "rejected",
    source: "direct",
    createdAt: "2025-09-10T14:00:00-06:00",
    updatedAt: "2025-10-01T11:05:00-06:00",
    publicJobHref: null,
  },
];

/** Two local CV metadata entries: the Spanish primary and the English secondary. */
const CV_SOURCE: readonly CandidateCv[] = [
  { id: "cv-principal", label: "CV principal", fileName: "ximena-barrera-cv.pdf", language: "es", sizeBytes: 348_160, updatedAt: "2026-03-10T10:00:00-06:00", isPrimary: true },
  { id: "cv-ingles", label: "CV en inglés", fileName: "ximena-barrera-resume-en.pdf", language: "en", sizeBytes: 297_984, updatedAt: "2026-02-18T16:40:00-06:00", isPrimary: false },
];

/** Freezes a value and every plain object and array reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** The frozen candidate application portfolio, validated at this boundary. */
export const CANDIDATE_APPLICATIONS: readonly CandidateApplicationView[] = deepFreeze(candidateApplicationViewsSchema.parse(APPLICATION_SOURCE));
/** The frozen local CV metadata inventory validated at this boundary. */
export const CANDIDATE_CVS: readonly CandidateCv[] = deepFreeze(candidateCvsSchema.parse(CV_SOURCE));
