import { jobsListSchema } from "./schemas";
import type { JobItem, JobsList } from "./types";
import { parseJobsQuery } from "./url";
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
export function findSampleJob(jobId: string): JobItem | undefined {
  return SAMPLE_JOBS.find((job) => job.id === jobId);
}

/** Canonicalizes the input exactly like the URL model, so direct calls are safe. */
function canonicalQuery(query: JobsQuery): JobsQuery {
  const raw = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) raw.append(key, value);
  }
  return parseJobsQuery(raw.toString());
}

/** Splits a search term into lowercased word tokens. */
function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "");
}

/** `q` matches every token, case-insensitively, across title and description. */
function matchesSearch(job: JobItem, q: string): boolean {
  const haystack = `${job.title} ${job.description}`.toLowerCase();
  return searchTokens(q).every((token) => haystack.includes(token));
}

/** Every present canonical predicate must match: strict AND, never OR. */
function matchesFilters(job: JobItem, query: JobsQuery): boolean {
  if (query.q !== undefined && !matchesSearch(job, query.q)) return false;
  if (query.seniority !== undefined && job.seniority !== query.seniority)
    return false;
  if (query.work_mode !== undefined && job.work_mode !== query.work_mode)
    return false;
  if (
    query.employment_type !== undefined &&
    job.employment_type !== query.employment_type
  )
    return false;
  if (
    query.location !== undefined &&
    !(job.location ?? "").toLowerCase().includes(query.location.toLowerCase())
  )
    return false;
  if (query.currency !== undefined && job.salary_currency !== query.currency)
    return false;
  return true;
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
export function listSampleJobs(query: JobsQuery): JobsList {
  const canonical = canonicalQuery(query);
  const matched = SAMPLE_JOBS.filter((job) => matchesFilters(job, canonical));
  const ordered = [...matched].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  const decoded =
    canonical.cursor === undefined ? null : decodeCursorOffset(canonical.cursor);
  const offset = decoded !== null && decoded <= ordered.length ? decoded : 0;
  const items = ordered.slice(offset, offset + SAMPLE_PAGE_SIZE);
  const nextOffset = offset + SAMPLE_PAGE_SIZE;
  const page: JobsList =
    nextOffset < ordered.length
      ? { items, next_cursor: encodeCursorOffset(nextOffset) }
      : { items };
  return jobsListSchema.parse(page);
}
