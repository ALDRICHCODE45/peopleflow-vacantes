import type { OrgCandidateDetail } from "@/features/org-candidates/detail/detail-model";
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Frozen detail examples: titles belong to manual records; organic uses its snapshot. */
export function detailFixture(kind: "manual" | "organic" = "manual"): OrgCandidateDetail {
  return {
    kind, id: id(1), full_name: "Lucía Ramírez Torres",
    etag: '"v1"', updated_at: kind === "organic" ? "2026-10-22T18:00:00Z" : null,
    updated_by: kind === "organic" ? { id: id(6), name: "Tomás Ríos" } : null,
    corrected_fields: kind === "organic" ? ["phone"] : [],
    original: kind === "organic" ? {
      full_name: "Lucía Ramírez Torres", contact: { email: "lucia@example.com", phone: "+523311112222" },
      professional_title: null, current_company: null,
      profile: { location: null, skills: ["React"], years_of_experience: "4.5", seniority: "senior", education: { highest_completed: "bachelor", in_progress: "master" }, languages: [{ code: "es", level: "native" }] },
      education: null, linkedin_url: null, portfolio_url: null,
    } : null,
    education: kind === "manual" ? [{ level: "bachelor", status: "completed", institution: "Universidad de Guadalajara", field: "Ingeniería", start_year: 2014, end_year: 2018 }] : null,
    skills: ["React"], linkedin_url: null, portfolio_url: null,
    professional_title: kind === "manual" ? "Desarrolladora Frontend" : null,
    current_company: kind === "manual" ? "Empresa actual" : null,
    contact: { email: "lucia@example.com", phone: "+523312345678" },
    profile: { location: null, skills: ["React"], years_of_experience: "4.5", seniority: "senior", education: { highest_completed: "bachelor", in_progress: "master" }, languages: [{ code: "es", level: "native" }] },
    participations: [{ id: id(2), vacancy: { id: id(3), title: "Frontend", lifecycle: { publication: "published", process: "active" } }, stage: { id: id(4), name: "Entrevista" }, state: "active", substate: { id: id(5), name: "Esperando respuesta" }, discard: null, source: "manual", applied_at: "2026-10-21T18:02:11Z", added_by: { id: id(6), name: "Tomás Ríos" }, cv: { file_name: "cv.pdf", uploaded_at: "2026-10-21T18:00:00Z" } }],
    created_by: kind === "manual" ? { id: id(6), name: "Tomás Ríos" } : null,
    created_at: "2026-10-20T18:00:00Z",
  };
}
