import type { CompanyProfile } from "../company-profile/model";
import type { JobItem } from "./types";
/**
 * Prototype read view for one public vacancy: the untouched wire `JobItem` plus
 * a display-only enrichment beside it. Nothing here is a wire field, nothing is
 * persisted, and every enriched value is fictional demo data.
 */
/** How often a prototype vacancy claims to pay. */
export type JobPayFrequency = "monthly" | "yearly" | "hourly";
/** Display-only extras the prototype attaches to one vacancy. */
export type PrototypeJobEnrichment = {
  readonly department: string;
  readonly skills: readonly string[];
  readonly benefits: readonly string[];
  readonly payFrequency: JobPayFrequency;
  readonly requiredRequirements: readonly string[];
  readonly preferredRequirements: readonly string[];
  readonly closingDate?: string;
  /** Fictional demo count a candidate would see beside the vacancy. */
  readonly applicantCount: number;
  /** Fictional demo estimate of how many days a reply takes. */
  readonly responseTimeDays: number;
  /** Whether the demo lists this vacancy as highlighted. */
  readonly featured: boolean;
  /** Whether the demo states PeopleFlow verified the process. */
  readonly verifiedByPeopleFlow: boolean;
  /** Spanish presentation string, e.g. the experience the demo claims. */
  readonly experienceLabel: string;
  /** Spanish presentation string for the fictional publication moment. */
  readonly publishedAgoLabel: string;
};
/** One vacancy as the prototype renders it: wire data first, extras beside it. */
export type PrototypeJobView = JobItem & {
  readonly prototype?: PrototypeJobEnrichment;
};
const FRONTEND_JOB_ENRICHMENT: PrototypeJobEnrichment = {
  department: "Ingeniería",
  skills: ["React", "TypeScript", "Accesibilidad web"],
  benefits: ["Seguro de salud", "Horario flexible", "Equipo de cómputo"],
  payFrequency: "monthly",
  requiredRequirements: ["Tres años construyendo interfaces con React y TypeScript.", "Experiencia con pruebas automatizadas de componentes."],
  preferredRequirements: ["Conocimiento de accesibilidad web (WCAG).", "Experiencia con Next.js."],
  closingDate: "2026-03-31",
  applicantCount: 24,
  responseTimeDays: 3,
  featured: true,
  verifiedByPeopleFlow: true,
  experienceLabel: "5+ años",
  publishedAgoLabel: "Hace 2 h",
};
const GO_JOB_ENRICHMENT: PrototypeJobEnrichment = {
  department: "Plataforma",
  skills: ["Go", "PostgreSQL", "Kubernetes"],
  benefits: ["Seguro de salud", "Días libres adicionales", "Presupuesto de capacitación"],
  payFrequency: "monthly",
  requiredRequirements: ["Experiencia diseñando servicios en Go para tráfico alto.", "Bases de datos relacionales y migraciones."],
  preferredRequirements: ["Experiencia con Kubernetes en producción."],
  applicantCount: 41,
  responseTimeDays: 2,
  featured: false,
  verifiedByPeopleFlow: true,
  experienceLabel: "6+ años",
  publishedAgoLabel: "Hace 5 h",
};
/** Freezes one enrichment and every list it owns. */
function freezeEnrichment(entry: PrototypeJobEnrichment): PrototypeJobEnrichment {
  return Object.freeze({
    ...entry,
    skills: Object.freeze([...entry.skills]),
    benefits: Object.freeze([...entry.benefits]),
    requiredRequirements: Object.freeze([...entry.requiredRequirements]),
    preferredRequirements: Object.freeze([...entry.preferredRequirements]),
  });
}
// Demo vacancies served by `frontend/tests/fixtures/jobs-server.mjs`.
const JOB_ENRICHMENTS: Readonly<Record<string, PrototypeJobEnrichment>> = {
  "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e": freezeEnrichment(FRONTEND_JOB_ENRICHMENT),
  "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92": freezeEnrichment(GO_JOB_ENRICHMENT),
};
/** Fictional extras for the demo vacancies, keyed by exact wire job id. */
export const PROTOTYPE_JOB_ENRICHMENTS: Readonly<
  Record<string, PrototypeJobEnrichment>
> = Object.freeze(JOB_ENRICHMENTS);
/** Prototype extras for one job id, or `undefined` for every unknown id. */
export function enrichmentForJob(jobId: string): PrototypeJobEnrichment | undefined {
  if (!Object.hasOwn(PROTOTYPE_JOB_ENRICHMENTS, jobId)) return undefined;
  return PROTOTYPE_JOB_ENRICHMENTS[jobId];
}
/** Attaches the extras to a copy of the wire vacancy, or copies it untouched. */
export function enrichJob(job: JobItem): PrototypeJobView {
  const prototype = enrichmentForJob(job.id);
  return prototype === undefined ? { ...job } : { ...job, prototype };
}
/** Keeps the vacancies of `profile` by exact id or source name, in caller order. */
export function jobsForPrototypeCompany(
  jobs: readonly JobItem[],
  profile: CompanyProfile,
): PrototypeJobView[] {
  return jobs
    .filter(
      (job) =>
        job.company.id === profile.companyId ||
        job.company.name === profile.sourceName,
    )
    .map(enrichJob);
}
