import { describe, expect, it } from "vitest";
import { profileReadSchema, profileWriteSchema, languagesSchema, profileFailure } from "./profile-api";
import { profileFromWire, profileToWrite } from "./profile-adapter";
import { parseProfileDraft, profileToDraft } from "./profile-draft";

const study = { level: "bachelor", institution: "UNAM", field: "Ingeniería", status: "completed", start_year: 2015, end_year: 2020 };
const profile = { user_id: "11111111-1111-4111-8111-111111111111", location: null, salary_currency: "MXN", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", seniority: "junior", years_of_experience: "1.5", education: [study] };
describe("harmonized profile contract", () => {
  it("round trips profile, draft and separate code-based languages", () => {
    const read = profileReadSchema.parse(profile);
    const baseline = profileFromWire(read, languagesSchema.parse({ languages: [{ code: "local:any-code", level: "native" }] }));
    const result = parseProfileDraft(profileToDraft(baseline), baseline);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(profileToWrite(result.profile)).toMatchObject({ seniority: "junior", years_of_experience: "1.5", education: [study] });
    expect(result.profile.languages).toEqual([{ code: "local:any-code", level: "native" }]);
    expect(profileToWrite(result.profile)).not.toHaveProperty("education_level");
    expect(profileToWrite(result.profile)).not.toHaveProperty("field_of_study");
  });
  it.each(["0", "0.0", "1.5", "59.9", "60", "60.0"])("accepts decimal string %s", years_of_experience => {
    expect(profileWriteSchema.safeParse({ years_of_experience }).success).toBe(true);
  });
  it.each(["01", "1.50", "60.5", "61", "-1", "1e1", " 1", "1.", 1.5])("rejects noncontract years %s", years_of_experience => {
    expect(profileWriteSchema.safeParse({ years_of_experience }).success).toBe(false);
  });
  it.each(["intern", "junior", "semi_senior", "senior", "lead", "manager", "director", null])("accepts seniority %s", seniority => {
    expect(profileWriteSchema.safeParse({ seniority }).success).toBe(true);
  });
  it("rejects guessed enums and removed fields", () => {
    for (const value of [{ seniority: "mid" }, { seniority: " Junior " }, { education_level: "bachelor" }, { field_of_study: "Go" }]) expect(profileWriteSchema.safeParse(value).success).toBe(false);
  });
  it("enforces education rules and allows repeated degrees", () => {
    for (const patch of [{ status: "in_progress", end_year: null }, { end_year: null }, { start_year: 1950, end_year: 2100 }]) expect(profileWriteSchema.safeParse({ education: [{ ...study, ...patch }] }).success).toBe(true);
    for (const patch of [{ status: "in_progress" }, { start_year: 2021 }, { start_year: 1949 }, { end_year: 2101 }, { start_year: 2015.5 }, { status: "finished" }, { level: "Bachelor" }, { institution: "x".repeat(121) }]) expect(profileWriteSchema.safeParse({ education: [{ ...study, ...patch }] }).success).toBe(false);
    expect(profileWriteSchema.safeParse({ education: Array(10).fill(study) }).success).toBe(true);
    expect(profileWriteSchema.safeParse({ education: Array(11).fill(study) }).success).toBe(false);
    expect(profileWriteSchema.safeParse({ education: [{ ...study, field: "😀".repeat(120) }] }).success).toBe(true);
  });
  it("reports long education text in Spanish at the indexed field", () => {
    const baseline = profileFromWire(profileReadSchema.parse(profile), { languages: [] });
    const draft = profileToDraft(baseline);
    const result = parseProfileDraft({ ...draft, education: [{ ...draft.education[0], institution: "x".repeat(121) }] }, baseline);
    expect(result).toEqual({ ok: false, issues: [{ path: "education.0.institution", message: "Usa hasta 120 caracteres." }] });
  });
  it("limits languages to ten unique opaque codes", () => {
    expect(languagesSchema.safeParse({ languages: [{ code: "", level: "A1" }] }).success).toBe(false);
    expect(languagesSchema.safeParse({ languages: [{ code: "es", level: "A1" }, { code: "es", level: "B2" }] }).success).toBe(false);
    expect(languagesSchema.safeParse({ languages: Array.from({ length: 11 }, (_, i) => ({ code: String(i), level: "A1" })) }).success).toBe(false);
  });
  it("preserves shared validation field paths", () => {
    const fields = [{ field: "education[1].status", code: "invalid" }, { field: "languages[0].code", code: "duplicate" }];
    expect(profileFailure({ error: { kind: "http", status: 400 }, envelope: { error: "Invalid", code: "validation_error", fields } })).toMatchObject({ reason: "invalid_request", reference: { code: "validation_error" }, fields });
  });
});
