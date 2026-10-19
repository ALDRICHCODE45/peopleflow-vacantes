import { describe, expect, it } from "vitest";
import { publicJobDetailSchema, publicJobItemSchema } from "../schemas";
import { listItem, vacancyDetail, legacyDetail } from "./public-fixtures";

const location = { country: { id: "MX", name: "México" }, state: { id: "09", name: "Ciudad de México" }, municipality: { id: "09002", name: "Azcapotzalco" }, postal_code: "02000", label: "Azcapotzalco, Ciudad de México" };
const countries = [{ id: "MX", name: "México" }, { id: "CO", name: "Colombia" }];
describe("public geography contract", () => {
  for (const [name, schema, base] of [["list", publicJobItemSchema, listItem(vacancyDetail)], ["detail", publicJobDetailSchema, vacancyDetail]] as const) {
    it(`${name} accepts structured, absent and legacy geography without normalization`, () => {
      for (const remote_scope of [null, { kind: "anywhere" }, { kind: "countries", countries }]) {
        const value = { ...base, work_mode: "remote", location, location_label: "Published label", remote_scope };
        expect(schema.parse(value)).toEqual(value);
      }
      expect(schema.safeParse({ ...base, location: null, location_label: null, remote_scope: null }).success).toBe(true);
    });
    it(`${name} rejects missing, extra and malformed geography`, () => {
      const value = { ...base, work_mode: "remote", location, location_label: "Published label", remote_scope: null };
      for (const key of ["location", "location_label", "remote_scope"]) {
        const missing = { ...value }; Reflect.deleteProperty(missing, key);
        expect(schema.safeParse(missing).success, key).toBe(false);
      }
      for (const key of Object.keys(location)) {
        const missing = { ...location }; Reflect.deleteProperty(missing, key);
        expect(schema.safeParse({ ...value, location: missing }).success, key).toBe(false);
      }
      for (const bad of ["CDMX", { ...location, extra: null }, { ...location, country: null }, { ...location, state: { id: 9, name: "CDMX" } }, { ...location, country: { ...location.country, extra: true } }]) {
        expect(schema.safeParse({ ...value, location: bad }).success).toBe(false);
      }
      for (const remote_scope of [{ kind: "anywhere", countries: [] }, { kind: "countries" }, { kind: "countries", countries: [] }, { kind: "countries", countries: [countries[0], countries[0]] }, { kind: "countries", countries: ["MX"] }, { kind: "unknown" }]) {
        expect(schema.safeParse({ ...value, remote_scope }).success).toBe(false);
      }
    });
  }
  it("rejects remote scopes on nonremote public vacancies and legacy rows", () => {
    for (const detail of [vacancyDetail, { ...vacancyDetail, work_mode: "onsite" as const }, legacyDetail]) {
      expect(publicJobItemSchema.safeParse({ ...listItem(detail), remote_scope: { kind: "anywhere" } }).success).toBe(false);
      expect(publicJobDetailSchema.safeParse({ ...detail, remote_scope: { kind: "anywhere" } }).success).toBe(false);
    }
  });
  it("preserves legacy free text only in location_label", () => {
    const value = { ...legacyDetail, location: null, location_label: "Zona centro, junto al parque", remote_scope: null };
    expect(publicJobDetailSchema.parse(value)).toEqual(value);
  });
});
