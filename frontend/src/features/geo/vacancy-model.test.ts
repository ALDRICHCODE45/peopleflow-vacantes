import { describe, expect, it } from "vitest";
import { locationReadSchema, locationWriteSchema, remoteScopeReadSchema, remoteScopeWriteSchema, locationReadToValue, locationValueToWrite, parseGeographyErrors, locationErrorMessages } from "./model";

const location = { country: { id: "MX", name: "México" }, state: { id: "01", name: "Aguascalientes" }, municipality: { id: "01001", name: "Aguascalientes" }, postal_code: "01000", label: "Aguascalientes, Aguascalientes" };
describe("vacancy geography", () => {
  it("decodes references strictly and serializes codes without names or labels", () => {
    expect(locationReadSchema.parse(location)).toEqual(location);
    expect(Object.keys(locationReadSchema.parse(location)!)).toHaveLength(5);
    expect(locationReadSchema.safeParse({ ...location, country: null }).success).toBe(false);
    for (const key of Object.keys(location)) {
      const partial: Record<string, unknown> = { ...location }; delete partial[key];
      expect(locationReadSchema.safeParse(partial).success).toBe(false);
    }
    expect(locationValueToWrite(locationReadToValue(location))).toEqual({ country: "MX", state: "01", municipality: "01001", postal_code: "01000" });
    expect(locationReadSchema.safeParse({ ...location, extra: true }).success).toBe(false);
    expect(locationReadSchema.safeParse("México").success).toBe(false);
    expect(locationWriteSchema.safeParse(location).success).toBe(false);
    expect(locationWriteSchema.parse({ country: "CO" })).toEqual({ country: "CO" });
    expect(locationValueToWrite(locationReadToValue(null))).toBeNull();
    expect(locationReadSchema.parse(null)).toBeNull();
  });
  it("preserves remote countries order and rejects empty, duplicate, oversized or named writes", () => {
    const scope = remoteScopeReadSchema.parse({ kind: "countries", countries: [{ id: "CO", name: "Colombia" }, { id: "MX", name: "México" }] });
    expect(scope?.kind === "countries" ? scope.countries.map(country => country.id) : null).toEqual(["CO", "MX"]);
    expect(remoteScopeWriteSchema.parse({ kind: "countries", countries: ["CO", "MX"] })).toEqual({ kind: "countries", countries: ["CO", "MX"] });
    for (const countries of [[], ["MX", "MX"], Array(51).fill("MX"), [{ id: "MX", name: "México" }]]) expect(remoteScopeWriteSchema.safeParse({ kind: "countries", countries }).success).toBe(false);
    expect(remoteScopeWriteSchema.safeParse({ kind: "anywhere", countries: [] }).success).toBe(false);
    expect(remoteScopeReadSchema.parse(null)).toBeNull();
    const distinct = Array.from({ length: 51 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26));
    expect(remoteScopeWriteSchema.safeParse({ kind: "countries", countries: distinct.slice(0, 50) }).success).toBe(true);
    expect(remoteScopeWriteSchema.safeParse({ kind: "countries", countries: distinct }).success).toBe(false);
  });
  it("rejects trailing newlines in catalog codes instead of accepting a partial regex match", () => {
    for (const [key, code] of Object.entries({ country: "MX", state: "01", municipality: "01001", postal_code: "01000" })) {
      expect(locationWriteSchema.safeParse({ country: "MX", [key]: `${code}\n` }).success).toBe(false);
    }
  });
  it("maps only recognized 422 envelopes with per-level and per-index details", () => {
    expect(parseGeographyErrors(422, { error: "invalid location", code: "invalid_location", details: [{ field: "fields.location.postal_code", reason: "mismatch" }] })).toEqual({ location: [{ field: "postal_code", reason: "mismatch" }], remoteScope: [] });
    expect(parseGeographyErrors(422, { error: "invalid scope", code: "invalid_remote_scope", details: [{ field: "fields.remote_scope.countries[1]", reason: "duplicate" }] })).toEqual({ location: [], remoteScope: [{ field: "countries", index: 1, reason: "duplicate" }] });
    expect(parseGeographyErrors(400, { code: "invalid_location", details: [] })).toBeNull();
    expect(parseGeographyErrors(422, { code: "invalid_location", details: [{ field: "fields.location.secret", reason: "unknown" }] })).toBeNull();
    expect(locationErrorMessages).toEqual({ required: "Completa este dato.", unknown: "Elige una opción de la lista.", mismatch: "El código postal no corresponde al municipio.", not_allowed: "Este dato no se puede guardar aquí." });
  });
});
