// Independent wire data; contract tests decode it with the product's schemas.
export const countries = { items: [{ id: "MX", name: "México" }, { id: "US", name: "Estados Unidos" }] };
export const states = { items: [{ id: "19", name: "Nuevo León" }, { id: "14", name: "Jalisco" }] };
export const municipalities = {
  "19": { items: [{ id: "19039", name: "Monterrey" }, { id: "19046", name: "San Nicolás de los Garza" }] },
  "14": { items: [{ id: "14039", name: "Guadalajara" }] },
};
export const languages = { items: [{ code: "es", name: "Español" }, { code: "en", name: "Inglés" }] };

export function publicDetail(seed) {
  const guadalajara = seed.location?.includes("Guadalajara");
  const state = states.items[guadalajara ? 1 : 0];
  const municipality = municipalities[state.id].items[0];
  const plain = seed.description;
  const collapsed = plain.replace(/\s+/gu, " ").trim();
  const excerpt = [...collapsed].slice(0, 240).join("").trim();
  const skills = seed.title.includes("Go") ? ["Go", "SQL"] : ["TypeScript", "React", "Accesibilidad"];
  const benefits = { predefined: ["health_insurance"], custom: ["Presupuesto de capacitación"] };
  return {
    id: seed.id, source: "vacancy", title: seed.title,
    company: { ...seed.company, logo_url: null },
    location: { country: countries.items[0], state, municipality, postal_code: null, label: seed.location ?? "Monterrey, Nuevo León" },
    location_label: seed.location ?? "Monterrey, Nuevo León",
    remote_scope: seed.work_mode === "remote" ? { kind: "anywhere" } : null,
    work_mode: seed.work_mode, work_schedule: seed.employment_type === "part_time" ? "part_time" : "full_time",
    contract_type: seed.employment_type === "contract" ? "professional_services" : "indefinite",
    professional_area: "technology_systems", seniority: seed.seniority,
    requirements_profile: { languages: [{ code: "en", min_level: "B2" }], min_years_of_experience: "3", min_education_level: null, accepts_in_progress_education: true },
    legacy_employment_type: null, legacy_salary: null,
    compensation: { mode: "range", amount: null, min: `${seed.salary_min ?? 30000}.00`, max: `${seed.salary_max ?? 45000}.00`, currency: seed.salary_currency, pay_period: "monthly", basis: "gross" },
    published_at: seed.published_at ?? "2026-02-14T09:30:00Z",
    description: { schema_version: 1, document: { type: "doc", content: plain.split(/\n\n/u).map(text => ({ type: "paragraph", content: [{ type: "text", text }] })) } },
    description_plain: plain, excerpt, excerpt_truncated: [...collapsed].length > 240,
    requirements: { required: "Experiencia construyendo software accesible y pruebas automatizadas.", preferred: "Colaboración en equipos multidisciplinarios." },
    benefits, benefits_preview: benefits, benefits_total: 2,
    skills, skills_preview: skills, skills_total: skills.length,
    applicants: "under_10", screening_questions: 2,
  };
}
export function publicItem(seed) {
  const { description, description_plain, requirements, benefits, skills, ...item } = publicDetail(seed);
  return item;
}
export function publicPayload(payload) {
  if (payload?.items) return { items: payload.items.map(publicItem), next_cursor: payload.next_cursor ?? null };
  return payload?.id ? publicDetail(payload) : payload;
}

// OR within repeated dimensions, AND across dimensions, matching the v2 URL keys.
export function matchesPublic(seed, params) {
  const item = publicDetail(seed);
  const q = params.get("q");
  if (q && !q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).every(token => `${seed.title} ${seed.description}`.toLowerCase().includes(token))) return false;
  for (const key of ["work_mode", "seniority"]) {
    const values = params.getAll(key);
    if (values.length && !values.includes(item[key])) return false;
  }
  for (const key of ["work_schedule", "contract_type", "professional_area"]) {
    if (params.has(key) && params.get(key) !== item[key]) return false;
  }
  for (const [key, actual] of [["state", item.location.state.id], ["municipality", item.location.municipality.id]]) {
    if (params.has(key) && !params.getAll(key).includes(actual)) return false;
  }
  if (params.has("language") && !params.getAll("language").some(code => item.requirements_profile.languages.some(language => language.code === code))) return false;
  if (params.has("applicant_country") && item.remote_scope === null && params.get("applicant_country") !== item.location.country.id) return false;
  if (params.has("years_of_experience") && Number(params.get("years_of_experience")) < 3) return false;
  if (params.has("education_level") && params.get("education_level") !== item.requirements_profile.min_education_level) return false;
  if (params.has("salary_min") || params.has("salary_max")) {
    const salary = item.compensation;
    if (params.get("salary_currency") !== salary.currency || params.get("salary_period") !== salary.pay_period || params.get("salary_basis") !== salary.basis) return false;
    if (params.has("salary_min") && Number(salary.max) < Number(params.get("salary_min"))) return false;
    if (params.has("salary_max") && Number(salary.min) > Number(params.get("salary_max"))) return false;
  }
  return true;
}

export function catalogResponse(path) {
  if (path === "/v2/catalogs/languages") return [200, languages];
  if (path === "/v2/geo/countries") return [200, countries];
  if (path === "/v2/geo/countries/MX/states") return [200, states];
  const state = path.match(/^\/v2\/geo\/countries\/MX\/states\/(\d{2})\/municipalities$/)?.[1];
  if (state) return municipalities[state] ? [200, municipalities[state]] : [404, { code: "state_not_found" }];
  const cp = path.match(/^\/v2\/geo\/countries\/MX\/postal-codes\/(\d{5})$/)?.[1];
  if (cp) return cp === "64000" ? [200, { postal_code: cp, matches: [{ state: states.items[0], municipality: municipalities["19"].items[0] }] }] : [404, { code: "postal_code_not_found" }];
}
