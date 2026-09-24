import { ACME_PROTOTYPE_PROFILE } from "../company-profile/prototype-companies";
import type { PrototypeJobView } from "./enrich";
import { jobsForPrototypeCompany } from "./enrich";
import type { JobItem } from "./types";

/**
 * The two demo vacancies the local jobs server serves
 * (`frontend/tests/fixtures/jobs-server.mjs`), copied verbatim so the prototype
 * renders exactly the wire payload the API returns — same ids, titles, enums,
 * and company blocks. No transport, schema, or state module is involved.
 */
const ACME_WIRE_JOB_SOURCE: readonly JobItem[] = [
  { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e", title: "Ingeniera Frontend", description: "Construye experiencias accesibles.", work_mode: "remote", employment_type: "full_time", seniority: "senior", salary_currency: "MXN", company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" } },
  { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92", title: "Desarrolladora Go", description: "Primer párrafo de la vacante.\n\n<script>alert('xss')</script>\n\nSegundo párrafo con <img src=x onerror=alert(1)> incrustado.\n\nLínea uno\nLínea dos.", work_mode: "hybrid", employment_type: "contract", seniority: "lead", salary_currency: "MXN", location: "Monterrey, Nuevo León", salary_min: 30000, salary_max: 45000, published_at: "2026-02-14T09:30:00Z", company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93", name: "Acme" } },
];
/** Freezes one wire job and the nested company block a card renders. */
function freezeWireJob(job: JobItem): JobItem {
  return Object.freeze({ ...job, company: Object.freeze({ ...job.company }) });
}
/** The frozen demo wire vacancies, in fixture order. */
export const ACME_WIRE_JOBS: readonly JobItem[] = Object.freeze(ACME_WIRE_JOB_SOURCE.map(freezeWireJob));
/**
 * The fictional company's own vacancies: the frozen wire fixtures narrowed to
 * the Acme profile by exact id or exact source name, with the CCP-01 prototype
 * enrichment attached. Every exported entry is frozen and its enrichment is
 * deep frozen by CCP-01, so no rendered view can be mutated. The filter copies
 * each job, so the wire fixtures stay intact.
 */
export const ACME_PROTOTYPE_JOBS: readonly PrototypeJobView[] = Object.freeze(
  jobsForPrototypeCompany(ACME_WIRE_JOBS, ACME_PROTOTYPE_PROFILE).map((view: PrototypeJobView) => Object.freeze(view)),
);
