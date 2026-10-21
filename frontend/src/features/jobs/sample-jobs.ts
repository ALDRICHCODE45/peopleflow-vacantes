import { publicJobDetailSchema, publicJobsListSchema } from "./schemas";
import { matchesSalaryFilter } from "./salary-filter";
import type { JobItem, PublicJobDetail, PublicJobItem, PublicJobsList } from "./types";
import { buildJobsUrl, parseJobsQuery, selectedValues } from "./url";
import type { JobsQuery } from "./url";

/**
 * Frontend-only sample mode dataset and its pure read logic.
 *
 * When `PEOPLEFLOW_SAMPLE_JOBS` is `true`, the list and detail reads answer from
 * this fixed ten-vacancy dataset instead of the backend. Nothing here performs a
 * request, writes data, or leaves the frontend: the flag is validated server-side
 * and the sample module stays a pure, testable value.
 *
 * The two `Acme` vacancies keep the exact fixture ids, titles, enums, and company
 * blocks the local fixtures and the prototype enrichment already rely on, so the
 * existing enrichment keeps matching them by id or by exact source name.
 */

/** One page of the sample listing; the whole dataset fits in a single page. */
export const SAMPLE_PAGE_SIZE = 10;

const SAMPLE_JOB_SOURCE: readonly JobItem[] = [
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
    title: "Ingeniera Frontend",
    description: "Construye experiencias accesibles.",
    work_mode: "remote",
    employment_type: "full_time",
    seniority: "senior",
    salary_currency: "MXN",
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
  },
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92",
    title: "Desarrolladora Go",
    description:
      "Primer párrafo de la vacante.\n\n<script>alert('xss')</script>\n\nSegundo párrafo con <img src=x onerror=alert(1)> incrustado.\n\nLínea uno\nLínea dos.",
    work_mode: "hybrid",
    employment_type: "contract",
    seniority: "lead",
    salary_currency: "MXN",
    location: "Monterrey, Nuevo León",
    salary_min: 30000,
    salary_max: 45000,
    published_at: "2026-02-14T09:30:00Z",
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93", name: "Acme" },
  },
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c70a1",
    title: "Analista de Datos",
    description:
      "Diseña tableros y modelos que ayudan al negocio a decidir con información confiable.",
    work_mode: "remote",
    employment_type: "full_time",
    seniority: "mid",
    salary_currency: "MXN",
    location: "Ciudad de México",
    salary_min: 35000,
    salary_max: 50000,
    published_at: "2026-03-02T15:00:00Z",
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c80b1", name: "Nube Andina" },
  },
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c70a2",
    title: "Analista de Datos Senior",
    description:
      "Lidera la estrategia de analítica, define métricas y cuida la calidad de los modelos del equipo.",
    work_mode: "remote",
    employment_type: "full_time",
    seniority: "senior",
    salary_currency: "MXN",
    location: "Ciudad de México",
    salary_min: 55000,
    salary_max: 75000,
    published_at: "2026-03-05T12:00:00Z",
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c80b1", name: "Nube Andina" },
  },
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c70a3",
    title: "Diseñadora UX",
    description:
      "Investiga con personas usuarias y convierte hallazgos en flujos claros y accesibles.",
    work_mode: "remote",
    employment_type: "part_time",
    seniority: "junior",
    salary_currency: "MXN",
    location: "Guadalajara, Jalisco",
    salary_min: 22000,
    salary_max: 30000,
    published_at: "2026-03-08T09:00:00Z",
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c80b2", name: "Estudio Horizonte" },
  },
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c70a4",
    title: "Ingeniero DevOps",
    description:
      "Automatiza despliegues sobre Kubernetes, administra clústeres y mantiene PostgreSQL saludable en producción.",
    work_mode: "hybrid",
    employment_type: "full_time",
    seniority: "senior",
    salary_currency: "USD",
    location: "Monterrey, Nuevo León",
    salary_min: 4500,
    salary_max: 6500,
    published_at: "2026-03-10T18:30:00Z",
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c80b3", name: "Bitácora Labs" },
  },
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c70a5",
    title: "Especialista en Marketing Digital",
    description:
      "Planea campañas, mide resultados y coordina contenido para atraer candidatos y clientes.",
    work_mode: "remote",
    employment_type: "contract",
    seniority: "mid",
    salary_currency: "MXN",
    location: "Puebla, Puebla",
    salary_min: 28000,
    salary_max: 38000,
    published_at: "2026-03-12T11:15:00Z",
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c80b4", name: "Mercado Central" },
  },
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c70a6",
    title: "Becario de Soporte Técnico",
    description:
      "Atiende solicitudes internas, documenta soluciones y aprende a operar herramientas de soporte.",
    work_mode: "onsite",
    employment_type: "internship",
    seniority: "intern",
    salary_currency: "MXN",
    location: "Querétaro, Querétaro",
    salary_min: 8000,
    salary_max: 10000,
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c80b5", name: "Soporte Ágil" },
  },
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c70a7",
    title: "Gerente de Ventas Regional",
    description:
      "Construye el plan comercial de la región y acompaña al equipo para cumplir metas trimestrales.",
    work_mode: "hybrid",
    employment_type: "full_time",
    seniority: "lead",
    salary_currency: "USD",
    location: "Ciudad de México",
    salary_min: 5000,
    salary_max: 7000,
    published_at: "2026-03-15T16:45:00Z",
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c80b4", name: "Mercado Central" },
  },
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c70a8",
    title: "Reclutadora Técnica",
    description:
      "Busca y acompaña talento de ingeniería, cuidando la experiencia de cada candidato durante el proceso.",
    work_mode: "onsite",
    employment_type: "part_time",
    seniority: "junior",
    salary_currency: "MXN",
    location: "Bogotá, Colombia",
    company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c80b6", name: "Talento Global" },
  },
];

/** Freezes one sample vacancy and its nested company block. */
function freezeJob(job: JobItem): JobItem {
  return Object.freeze({ ...job, company: Object.freeze({ ...job.company }) });
}

/** The frozen sample vacancies, in source order. */
export const SAMPLE_JOBS: readonly JobItem[] = Object.freeze(
  SAMPLE_JOB_SOURCE.map(freezeJob),
);

/** Whether one sample vacancy carries the exact id. */
export function findSampleJob(jobId: string): PublicJobDetail | undefined {
  return PUBLIC_SAMPLE_DETAILS.find((job) => job.id === jobId);
}

/** Mirrors the public excerpt contract for this explicitly fictional, local-only adapter. */
function sampleExcerpt(description: string): { excerpt: string | null; excerpt_truncated: boolean } {
  const normalized = description.replace(/\p{White_Space}+/gu, " ").replace(/^ | $/gu, "");
  const points = [...normalized];
  if (points.length <= 240) return { excerpt: normalized || null, excerpt_truncated: false };
  const prefix = points.slice(0, 240).join("");
  const boundary = prefix.lastIndexOf(" ");
  return { excerpt: (boundary > 0 ? prefix.slice(0, boundary) : prefix).replace(/ $/u, ""), excerpt_truncated: true };
}

// Explicit fictional publication date for the sample records that predate
// publication metadata. This adapter never runs against a real API response.
const PUBLIC_SAMPLE_DETAILS: readonly PublicJobDetail[] = SAMPLE_JOBS.map((job) => publicJobDetailSchema.parse({
  id: job.id, source: "legacy", title: job.title, company: { ...job.company, logo_url: null },
  location: null, location_label: job.location ?? null, remote_scope: null, work_mode: job.work_mode,
  work_schedule: null, contract_type: null, professional_area: null,
  seniority: job.seniority === "mid" ? "semi_senior" : job.seniority, legacy_employment_type: job.employment_type,
  requirements_profile: { languages: [], min_years_of_experience: null, min_education_level: null, accepts_in_progress_education: false },
  compensation: null,
  legacy_salary: job.salary_min === undefined && job.salary_max === undefined ? null : {
    min: job.salary_min?.toFixed(2) ?? null, max: job.salary_max?.toFixed(2) ?? null, currency: job.salary_currency,
  },
  published_at: job.published_at ?? "2026-02-14T09:30:00Z",
  description: null, description_plain: job.description,
  requirements: { required: null, preferred: null }, benefits: { predefined: [], custom: [] },
  ...sampleExcerpt(job.description),
  benefits_preview: { predefined: [], custom: [] }, benefits_total: 0,
  skills_preview: [], skills_total: 0, skills: [],
  applicants: null, screening_questions: null,
}));

function sampleItem(detail: PublicJobDetail): PublicJobItem {
  const item = { ...detail };
  for (const key of ["description", "description_plain", "requirements", "benefits", "skills"]) Reflect.deleteProperty(item, key);
  return item;
}

/** Canonicalizes the input exactly like the URL model, so direct calls are safe. */
function canonicalQuery(query: JobsQuery): JobsQuery {
  return parseJobsQuery(buildJobsUrl(query).split("?")[1] ?? "");
}

/** Splits a search term into lowercased word tokens. */
function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "");
}

/** `q` matches every token, case-insensitively, across title and description. */
function matchesSearch(job: PublicJobDetail, q: string): boolean {
  const haystack = `${job.title} ${job.description_plain}`.toLowerCase();
  return searchTokens(q).every((token) => haystack.includes(token));
}

/** Every present canonical predicate must match: strict AND, never OR. */
function matchesFilters(job: PublicJobDetail, query: JobsQuery): boolean {
  if (query.q !== undefined && !matchesSearch(job, query.q)) return false;
  for (const key of ["work_schedule", "contract_type", "professional_area"] as const) {
    if (query[key] !== undefined && job[key] !== query[key]) return false;
  }
  if (query.work_mode !== undefined && !selectedValues(query.work_mode).includes(job.work_mode)) return false;
  if (query.state !== undefined && (!job.location?.state || !selectedValues(query.state).includes(job.location.state.id))) return false;
  if (query.municipality !== undefined && (!job.location?.municipality || !selectedValues(query.municipality).includes(job.location.municipality.id))) return false;
  if (query.applicant_country !== undefined && job.work_mode === "remote") {
    const scope = job.remote_scope;
    if (!scope || (scope.kind === "countries" && !scope.countries.some(country => country.id === query.applicant_country))) return false;
  }
  return matchesSalaryFilter(job.compensation, query);
}

/**
 * Decodes an opaque sample cursor into a page offset. A cursor that is not a
 * plain non-negative integer offset is rejected, never trusted or interpreted
 * as anything else.
 */
function decodeCursorOffset(cursor: string): number | null {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  return /^(?:0|[1-9]\d*)$/.test(decoded) ? Number(decoded) : null;
}

/** Encodes a page offset as an opaque sample cursor. */
function encodeCursorOffset(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

/**
 * Pure sample listing: canonicalizes the query, applies the six canonical
 * filters conjunctively, orders by id for determinism, then paginates. An
 * absent or malformed cursor starts a fresh first page, so an untrusted cursor
 * can never select an arbitrary slice. The result parses through the list
 * schema, keeping the sample read on the same contract as the wire read.
 */
export function listSampleJobs(query: JobsQuery): PublicJobsList {
  const canonical = canonicalQuery(query);
  const matched = PUBLIC_SAMPLE_DETAILS.filter((job) => matchesFilters(job, canonical));
  const ordered = [...matched].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  const decoded =
    canonical.cursor === undefined ? null : decodeCursorOffset(canonical.cursor);
  const offset = decoded !== null && decoded <= ordered.length ? decoded : 0;
  const items = ordered.slice(offset, offset + SAMPLE_PAGE_SIZE).map(sampleItem);
  const nextOffset = offset + SAMPLE_PAGE_SIZE;
  const page: PublicJobsList =
    nextOffset < ordered.length
      ? { items, next_cursor: encodeCursorOffset(nextOffset) }
      : { items, next_cursor: null };
  return publicJobsListSchema.parse(page);
}
