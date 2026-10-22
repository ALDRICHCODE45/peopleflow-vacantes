import { describe, expect, it } from "vitest";
import { candidateProfileSchema } from "./model";
import { CANDIDATE_PROFILE } from "./prototype-candidate";
import { profileToDraft, parseProfileDraft } from "./profile-draft";
import { profileFromWire, profileToWrite } from "./profile-adapter";
const location = { country: { id: "MX", name: "México" }, state: { id: "01", name: "Aguascalientes" }, municipality: { id: "01001", name: "Aguascalientes" }, postal_code: null, label: "Etiqueta del servidor" };
describe("structured candidate profile editor", () => {
  it("requires a strict expanded location rather than legacy city/country", () => {
    expect(candidateProfileSchema.safeParse({ ...CANDIDATE_PROFILE, location }).success).toBe(true);
    expect(candidateProfileSchema.safeParse({ ...CANDIDATE_PROFILE, city: "legacy" }).success).toBe(false);
  });
  it("maps catalog references to codes and serializes every profile-owned field", () => {
    const profile = { ...CANDIDATE_PROFILE, location };
    const draft = profileToDraft(profile);
    expect(draft.location).toEqual({ country: "MX", state: "01", municipality: "01001", postal_code: null });
    const parsed = parseProfileDraft(draft, profile);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Expected valid draft");
    const body = profileToWrite(parsed.profile);
    expect(body.location).toEqual({ country: "MX", state: "01", municipality: "01001" });
    expect(Object.keys(body).sort()).toEqual(["phone", "linkedin_url", "portfolio_url", "professional_title", "current_company", "years_of_experience", "profile_summary", "birth_date", "location", "education", "seniority", "skills", "current_salary_gross", "current_salary_net", "expected_salary", "salary_currency", "expected_salary_period"].sort());
    expect(body).not.toHaveProperty("languages");
    expect(body).not.toHaveProperty("user_id");
  });
  it("clears location with null and never serializes postal code", () => {
    const draft = profileToDraft({ ...CANDIDATE_PROFILE, location: null });
    const result = parseProfileDraft(draft, CANDIDATE_PROFILE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(profileToWrite(result.profile).location).toBeNull();
    expect(parseProfileDraft({ ...draft, location: { country: "MX", state: "01", municipality: "01001", postal_code: "01000" } }, CANDIDATE_PROFILE).ok).toBe(false);
  });
  it("hydrates omitted wire fields honestly, with server labels and separately loaded languages", () => {
    const profile = profileFromWire({ user_id: "11111111-1111-4111-8111-111111111111", location, salary_currency: "MXN", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }, { languages: [{ code: "en", level: "B2" }] });
    expect(profile.location?.label).toBe("Etiqueta del servidor");
    expect(profile.phone).toBeNull();
    expect(profile.skills).toEqual([]);
    expect(profile.languages).toEqual([{ code: "en", level: "B2" }]);
  });
});
