import type { PublicJobDetail, PublicJobItem } from "../types";

/** Contract fixtures for mocked public reads; never imported by product views. */
export const vacancyDetail = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92",
  source: "vacancy",
  title: "Backend Go",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93", name: "Acme" },
  location: "Ciudad de México",
  work_mode: "hybrid",
  work_schedule: "full_time",
  contract_type: "indefinite",
  professional_area: "technology_systems",
  seniority: null,
  legacy_employment_type: null,
  compensation: { mode: "range", amount: null, min: "30000.00", max: "40000.00", currency: "MXN", pay_period: "monthly", basis: "gross" },
  legacy_salary: null,
  published_at: "2026-10-16T18:00:00.000000Z",
  description: { schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Construye servicios seguros.", marks: [{ type: "bold" }] }] }] } },
  description_plain: "Construye servicios seguros.",
  requirements: { required: "Experiencia con Go", preferred: "PostgreSQL" },
  benefits: { predefined: ["health_insurance"], custom: ["Apoyo de transporte"] },
} satisfies PublicJobDetail;

export const legacyDetail = {
  ...vacancyDetail,
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  source: "legacy",
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
} satisfies PublicJobDetail;

export function listItem(detail: PublicJobDetail): PublicJobItem {
  const item = { ...detail };
  for (const key of ["description", "description_plain", "requirements", "benefits"]) Reflect.deleteProperty(item, key);
  return item;
}
