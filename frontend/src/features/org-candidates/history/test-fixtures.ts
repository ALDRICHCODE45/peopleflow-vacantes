export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const identity = { kind: "manual" as const, id: id(1) };
export const study = { level: "bachelor" as const, institution: null, field: null, status: "completed" as const, start_year: null, end_year: null };
export const location = { country: { id: "MX", name: "México" }, state: { id: "14", name: "Jalisco" }, municipality: { id: "14120", name: "Zapopan" }, postal_code: null, label: "Zapopan, Jalisco, México" };
export const edit = { id: id(2), at: "2026-10-22T18:00:00Z", actor: { id: id(3), name: "Tomás Ríos" }, kind: "edit" as const,
  changes: [{ field: "phone" as const, contact: true as const }, { field: "years_of_experience" as const, from: "2", to: "4" }, { field: "seniority" as const, reset: true as const, from: "senior" as const, to: "junior" as const }] };
export const cv = { id: id(4), at: "2026-10-21T18:00:00Z", actor: { id: id(3), name: null }, kind: "cv_corrected" as const, participation_id: id(5), file_name: "cv-corregido.pdf" };
export const page = { items: [edit, cv], next_cursor: null };
