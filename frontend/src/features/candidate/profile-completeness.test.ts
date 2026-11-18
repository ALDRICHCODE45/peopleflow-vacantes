import { expect, it } from "vitest";
import { profileFromWire } from "./profile-adapter";
import { draftCompleteness, KEY_DATA, missingProfileText, profileCompleteness } from "./profile-completeness";
import { profileToDraft } from "./profile-draft";
import { CANDIDATE_PROFILE } from "./prototype-candidate";

const empty = profileFromWire({ user_id: "u", salary_currency: "MXN", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", location: null }, { languages: [] });

it("defines the ten key data points once, without LinkedIn, portfolio or seniority", () => {
  expect(KEY_DATA.map(item => item.label)).toEqual(["título profesional", "empresa actual", "años de experiencia", "resumen profesional", "teléfono", "ubicación", "estudios", "habilidades", "salario esperado", "idiomas"]);
  expect(KEY_DATA.map(item => item.key)).toEqual(["professionalTitle", "currentCompany", "yearsOfExperience", "summary", "phone", "location", "education", "skills", "expectedSalary", "languages"]);
});

it("scores a saved profile with the same ten points the editor uses", () => {
  const profile = profileFromWire({ user_id: "u", salary_currency: "MXN", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", location: null, years_of_experience: "0", expected_salary: 0, linkedin_url: "https://example.com", seniority: "junior" }, { languages: [] });
  const snapshot = structuredClone(profile);
  expect(profileCompleteness(profile)).toMatchObject({ completed: 2, total: 10, percentage: 20, missing: ["título profesional", "empresa actual", "resumen profesional", "teléfono", "ubicación", "estudios", "habilidades", "idiomas"] });
  expect(profile).toEqual(snapshot);
  expect(profileCompleteness(null)).toMatchObject({ completed: 0, total: 10, percentage: 0 });
  expect(profileCompleteness({ ...profile, professionalTitle: "  " }).missing).toContain("título profesional");
  expect(profileCompleteness(CANDIDATE_PROFILE)).toMatchObject({ completed: 10, total: 10, percentage: 100, missing: [] });
});

it("scores the live draft: a study needs level and status, a language needs code and level", () => {
  const draft = profileToDraft(empty);
  expect(draftCompleteness(draft).completed).toBe(0);
  const partial = { ...draft, education: [{ level: "bachelor" as const, institution: "", field: "", status: "" as const, start_year: "", end_year: "" }], languages: [{ code: "en", level: "" as const }] };
  expect(draftCompleteness(partial).missing).toEqual(expect.arrayContaining(["estudios", "idiomas"]));
  const filled = { ...partial, education: [{ ...partial.education[0], status: "completed" as const }], languages: [{ code: "en", level: "B2" as const }], location: { country: "MX", state: null, municipality: null, postal_code: null } };
  expect(draftCompleteness(filled).items.filter(item => item.done).map(item => item.key)).toEqual(["location", "education", "languages"]);
});

it("names missing fields in plain Spanish", () => {
  expect(missingProfileText(["teléfono", "ubicación"])).toBe("teléfono y ubicación");
  expect(missingProfileText(["estudios", "teléfono", "ubicación"])).toBe("estudios, teléfono y ubicación");
  expect(missingProfileText(["teléfono"])).toBe("teléfono");
  expect(missingProfileText([])).toBe("");
});
