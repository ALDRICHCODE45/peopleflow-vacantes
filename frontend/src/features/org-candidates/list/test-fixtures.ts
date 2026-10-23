export const candidateId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
export const candidate = {
  kind: "manual" as const, id: candidateId, full_name: "Mariana Ortega Silva",
  professional_title: "Desarrolladora Frontend", current_company: null,
  profile: {
    location: { country: { id: "MX", name: "México" }, state: { id: "14", name: "Jalisco" }, municipality: { id: "14039", name: "Guadalajara" }, postal_code: null, label: "Guadalajara, Jalisco" },
    skills: ["Go"], years_of_experience: "4.5", seniority: "senior" as const,
    education: { highest_completed: "bachelor" as const, in_progress: "master" as const },
    languages: [{ code: "en", level: "C1" as const }],
  },
  corrected_fields: [],
  participations: { total: 2, active: 1 },
  latest_participation: { vacancy: { id: candidateId, title: "Backend Go", lifecycle: { publication: "published" as const, process: "active" as const } }, stage: { id: candidateId, name: "Entrevista" }, state: "active" as const, applied_at: "2026-10-21T18:02:11Z" },
  last_activity_at: "2026-10-21T18:02:11Z",
};
export const page = { items: [candidate], total: 37, next_cursor: null };
