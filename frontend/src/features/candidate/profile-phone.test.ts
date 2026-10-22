import { describe, expect, it } from "vitest";
import { CANDIDATE_PROFILE } from "./prototype-candidate";
import { candidateProfileSchema } from "./model";
import { profileReadSchema, profileWriteSchema } from "./profile-api";
import { parseProfileDraft, profileToDraft } from "./profile-draft";
import { profileFieldIssues } from "./profile-field-errors";

const baseline = { ...CANDIDATE_PROFILE, phone: "+525548217790" };
const mexico = "Escribe los 10 dígitos del teléfono en México.";
const international = "Escribe una lada y un número válidos, de 8 a 15 dígitos en total.";

describe("S3 profile phone", () => {
  it.each([
    ["+52", "5512345678", "+525512345678"],
    ["+1", "2125551234", "+12125551234"],
    ["+52", "(55) 1234-5678", "+525512345678"],
    ["+1", "2345678", "+12345678"],
    ["+123", "456789012345", "+123456789012345"],
  ])("accepts %s / %s as E.164", (dial, phone, expected) => {
    const draft = { ...profileToDraft(baseline), dial, phone };
    const parsed = parseProfileDraft(draft, baseline);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.profile.phone).toBe(expected);
  });
  it.each([
    ["+52", "551234567", mexico], ["+52", "55123456789", mexico],
    ["+52", "texto libre", mexico], ["+52", "+525512345678", mexico],
    ["+1", "123456", international], ["+1", "123456789012345", international],
    ["+0", "1234567890", international], ["52", "5512345678", international],
    ["+1234", "56789012", international], ["+1 ", "2125551234", international],
  ])("rejects %s / %s with the intake message", (dial, phone, message) => {
    const draft = { ...profileToDraft(baseline), dial, phone };
    expect(parseProfileDraft(draft, baseline)).toEqual({ ok: false, issues: [{ path: "phone", message }] });
  });
  it.each([
    ["+525548217790", "+52", "5548217790"],
    ["+12125551234", "+1", "2125551234"],
    ["+358401234567", "+358", "401234567"],
  ])("splits loaded %s using known dials then the longest generic prefix", (phone, dial, number) => {
    const profile = { ...baseline, phone };
    const draft = profileToDraft(profile);
    expect(draft).toMatchObject({ dial, phone: number });
    const parsed = parseProfileDraft(draft, profile);
    expect(parsed.ok && parsed.profile.phone).toBe(phone);
  });
  it.each([null, ""])('defaults an empty phone %s to +52 and permits clearing it', phone => {
    const draft = profileToDraft({ ...baseline, phone });
    expect(draft).toMatchObject({ dial: "+52", phone: "" });
    const parsed = parseProfileDraft(draft, baseline);
    expect(parsed.ok && parsed.profile.phone).toBeNull();
  });
  it.each([["+52 55 4821 7790", "+52", "5548217790", "+525548217790"], ["55-1234-5678", "+52", "5512345678", "+525512345678"], ["(55) 1234 5678", "+52", "5512345678", "+525512345678"], ["+1 415 555 0100", "+1", "4155550100", "+14155550100"]])('normalizes legacy %s to dial %s and number %s on load', (phone, dial, number, sent) => {
    const profile = { ...baseline, phone };
    const draft = profileToDraft(profile);
    expect(draft).toMatchObject({ dial, phone: number });
    const parsed = parseProfileDraft(draft, profile);
    expect(parsed.ok && parsed.profile.phone).toBe(sent);
  });
  it.each(["llamar por la tarde", "+5255123", "551234"])('keeps legacy %s visible but requires correction', phone => {
    const profile = { ...baseline, phone };
    const draft = profileToDraft(profile);
    expect(draft.phone).toBe(phone);
    expect(parseProfileDraft(draft, profile)).toEqual({ ok: false, issues: [{ path: "phone", message: international }] });
  });
  it.each(["5512345678", "+52 55 1234 5678", " +525512345678", "+52551234567", "+012345678", "+1234567890123456"])('rejects non-E.164 %s in outbound schemas but can load legacy data', phone => {
    expect(candidateProfileSchema.safeParse({ ...baseline, phone }).success).toBe(false);
    expect(profileWriteSchema.safeParse({ phone }).success).toBe(false);
    expect(profileReadSchema.safeParse({ user_id: "6f1a3c2e-9b4d-4e7a-8c2f-5d3b1a9e7f04", phone, salary_currency: "MXN", location: null, created_at: baseline.createdAt, updated_at: baseline.updatedAt }).success).toBe(true);
  });
  it.each([["+52", mexico], ["+1", international]])("maps backend phone invalid for %s", (dial, message) => {
    expect(profileFieldIssues([{ field: "phone", code: "invalid" }], dial)).toEqual([{ path: "phone", message }]);
  });
});
