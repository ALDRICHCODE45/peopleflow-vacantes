import { describe, expect, it } from "vitest";
import { profileReadSchema, profileWriteSchema, languagesSchema, profileLocationErrors } from "./profile-api";

export const wireProfile = {
  user_id: "11111111-1111-4111-8111-111111111111",
  location: null,
  salary_currency: "MXN",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
const location = { country: { id: "MX", name: "México" }, state: { id: "01", name: "Aguascalientes" }, municipality: null, postal_code: null, label: "Etiqueta del servidor" };

describe("candidate profile wire boundary", () => {
  it("accepts omitted nullable fields but requires the five-key location and preserves its label", () => {
    expect(profileReadSchema.parse(wireProfile).location).toBeNull();
    expect(profileReadSchema.parse({ ...wireProfile, location }).location).toEqual(location);
    const { location: omitted, ...missing } = wireProfile;
    expect(omitted).toBeNull();
    expect(profileReadSchema.safeParse(missing).success).toBe(false);
    expect(profileReadSchema.safeParse({ ...wireProfile, location: { country: location.country } }).success).toBe(false);
  });
  it("rejects legacy and unknown response fields", () => {
    for (const extra of [{ city: "City" }, { country: "MX" }, { cv_s3_key: "private" }, { languages: [] }]) {
      expect(profileReadSchema.safeParse({ ...wireProfile, ...extra }).success).toBe(false);
    }
  });
  it("writes only codes and supports explicit clearing", () => {
    expect(profileWriteSchema.parse({ location: { country: "MX", state: "01", municipality: "01001" } }).location).toEqual({ country: "MX", state: "01", municipality: "01001" });
    expect(profileWriteSchema.parse({ location: null }).location).toBeNull();
    for (const postal_code of [null, "", "01000"]) {
      expect(profileWriteSchema.safeParse({ location: { country: "MX", postal_code } }).success).toBe(false);
    }
    expect(profileWriteSchema.safeParse({ location }).success).toBe(false);
    expect(profileWriteSchema.safeParse({ city: "Old" }).success).toBe(false);
  });
  it("validates language levels and duplicates before writing", () => {
    expect(languagesSchema.safeParse({ languages: [{ code: "en", level: "" }] }).success).toBe(false);
    expect(languagesSchema.safeParse({ languages: [{ code: "en", level: "B2" }, { code: "en", level: "C1" }] }).success).toBe(false);
    expect(languagesSchema.parse({ languages: [{ code: "en", level: "B2" }] })).toEqual({ languages: [{ code: "en", level: "B2" }] });
  });
  it.each(["country", "state", "municipality", "postal_code"])("adapts the profile %s error to the shared geo parser", field => {
    expect(profileLocationErrors(422, { error: "invalid location", code: "invalid_location", details: [{ field: `location.${field}`, reason: "unknown" }] })).toEqual([{ field, reason: "unknown" }]);
  });
  it("rejects malformed or unrelated location errors", () => {
    expect(profileLocationErrors(400, { code: "invalid_location" })).toEqual([]);
    expect(profileLocationErrors(422, { error: "raw", code: "invalid_location", details: [{ field: "location.city", reason: "unknown" }] })).toEqual([]);
  });
});
