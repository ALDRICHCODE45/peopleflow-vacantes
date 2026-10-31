import { expect, it } from "vitest";
import { profileFromWire } from "./profile-adapter";
import { missingProfileText, profileCompleteness } from "./profile-completeness";
it("uses the existing twelve-field checklist over normalized real profile data", () => {
  const profile = profileFromWire({ user_id: "u", salary_currency: "MXN", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", location: null, years_of_experience: "0", expected_salary: 0 }, { languages: [] });
  const snapshot = structuredClone(profile);
  expect(profileCompleteness(profile)).toEqual({ completed: 2, total: 12, percentage: 17, missing: ["título profesional", "resumen profesional", "teléfono", "ubicación", "estudios", "nivel de experiencia", "habilidades", "idiomas", "LinkedIn", "portafolio"] });
  expect(profile).toEqual(snapshot);
  expect(profileCompleteness(null)).toMatchObject({ completed: 0, total: 12, percentage: 0 });
  expect(profileCompleteness({ ...profile, professionalTitle: "  " }).missing).toContain("título profesional");
});
it("names missing fields in plain Spanish", () => {
  expect(missingProfileText(["teléfono", "ubicación"])).toBe("teléfono y ubicación");
  expect(missingProfileText(["estudios", "teléfono", "ubicación"])).toBe("estudios, teléfono y ubicación");
  expect(missingProfileText(["teléfono"])).toBe("teléfono");
  expect(missingProfileText([])).toBe("");
});
