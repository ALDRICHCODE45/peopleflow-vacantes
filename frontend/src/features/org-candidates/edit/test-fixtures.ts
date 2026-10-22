import { detailFixture } from "../detail/test-fixtures";
import type { EditableOrgCandidate, CandidateEditValues } from "./edit-model";
export function editFixture(kind: "manual" | "organic" = "manual"): EditableOrgCandidate {
 const detail = detailFixture(kind);
 return { ...detail, etag: '"v1"', education: kind === "manual" ? [] : null, updated_at: null, updated_by: null, corrected_fields: [], original: kind === "manual" ? null : { full_name: detail.full_name, contact: detail.contact, professional_title: null, current_company: null, profile: detail.profile, education: null, linkedin_url: null, portfolio_url: null }, skills: ["React"], linkedin_url: "https://linkedin.com/in/lucia", portfolio_url: null };
}
export function valuesFixture(): CandidateEditValues {
 return { full_name: "Lucía Ramírez Torres", email: "lucia@example.com", phone: "+523312345678", location: null, professional_title: "Frontend", current_company: null, seniority: "senior", years_of_experience: "4.5", education: [], languages: [{ code: "es", level: "native" }], skills: ["React"], linkedin_url: null, portfolio_url: null };
}
