import type { PublicJobDetail, PublicJobItem } from "../types";

/** Contract fixtures for mocked public reads; never imported by product views. */
export const vacancyDetail = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92",
  source: "vacancy",
  title: "Backend Go",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93", name: "Acme", logo_url: null },
  location: { country: { id: "MX", name: "México" }, state: { id: "09", name: "Ciudad de México" }, municipality: null, postal_code: null, label: "Ciudad de México" },
  location_label: "Ciudad de México",
  remote_scope: null,
  work_mode: "hybrid",
  work_schedule: "full_time",
  contract_type: "indefinite",
  professional_area: "technology_systems",
  seniority: null,
  requirements_profile: {
    languages: [], min_years_of_experience: null,
    min_education_level: null, accepts_in_progress_education: false,
  },
  legacy_employment_type: null,
  compensation: { mode: "range", amount: null, min: "30000.00", max: "40000.00", currency: "MXN", pay_period: "monthly", basis: "gross" },
  legacy_salary: null,
  published_at: "2026-10-16T18:00:00.000000Z",
  description: { schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Construye servicios seguros.", marks: [{ type: "bold" }] }] }] } },
  description_plain: "Construye servicios seguros.",
  excerpt: "Construye servicios seguros.", excerpt_truncated: false,
  benefits_preview: { predefined: ["health_insurance"], custom: ["Apoyo de transporte"] }, benefits_total: 2,
  skills_preview: ["Go", "SQL"], skills_total: 2, skills: ["Go", "SQL"],
  applicants: "under_10", screening_questions: 0,
  requirements: { required: "Experiencia con Go", preferred: "PostgreSQL" },
  benefits: { predefined: ["health_insurance"], custom: ["Apoyo de transporte"] },
} satisfies PublicJobDetail;

export const legacyDetail = {
  ...vacancyDetail,
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  source: "legacy",
  location: null,
  title: "Ingeniera Frontend",
  work_mode: "remote",
  work_schedule: null,
  contract_type: null,
  professional_area: null,
  seniority: "senior",
  legacy_employment_type: "full_time",
  compensation: null,
  legacy_salary: { min: "30000.00", max: "45000.00", currency: "MXN" },
  description: null,
  description_plain: "Construye experiencias accesibles.",
  requirements: { required: null, preferred: null },
  benefits: { predefined: [], custom: [] },
  excerpt: "Construye experiencias accesibles.", excerpt_truncated: false,
  benefits_preview: { predefined: [], custom: [] }, benefits_total: 0,
  skills_preview: [], skills_total: 0, skills: [],
  applicants: null, screening_questions: null,
} satisfies PublicJobDetail;

export function listItem(detail: Extract<PublicJobDetail, { source: "vacancy" }>): Extract<PublicJobItem, { source: "vacancy" }>;
export function listItem(detail: Extract<PublicJobDetail, { source: "legacy" }>): Extract<PublicJobItem, { source: "legacy" }>;
export function listItem(detail: PublicJobDetail): PublicJobItem;
export function listItem(detail: PublicJobDetail): PublicJobItem {
  const item = { ...detail };
  for (const key of ["description", "description_plain", "requirements", "benefits", "skills"]) Reflect.deleteProperty(item, key);
  return item;
}
