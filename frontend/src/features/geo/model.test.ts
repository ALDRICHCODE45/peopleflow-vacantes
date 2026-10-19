import { describe, expect, it } from "vitest";
import { countriesSchema, statesSchema, municipalitiesSchema, postalSchema, mapFailure } from "./model";

const state = { id: "01", name: "Aguascalientes" };
const municipality = { id: "01001", name: "Aguascalientes" };
describe("geo decoders", () => {
  it.each([[countriesSchema, "MX"], [statesSchema, "01"], [municipalitiesSchema, "01001"]] as const)("preserves catalog strings", (schema, id) => {
    expect(schema.parse({ items: [{ id, name: "Nombre" }] }).items[0].id).toBe(id);
    for (const bad of [1, "mx", "1", " MX", "010001"]) expect(schema.safeParse({ items: [{ id: bad, name: "Nombre" }] }).success).toBe(false);
    expect(schema.safeParse({ items: [{ id, name: "Nombre", extra: true }] }).success).toBe(false);
    expect(schema.safeParse({ items: [], extra: true }).success).toBe(false);
  });
  it("strictly decodes every nested postal object", () => {
    const data = { postal_code: "01000", matches: [{ state, municipality }] };
    expect(postalSchema.parse(data)).toEqual(data);
    for (const bad of [{ ...data, extra: 1 }, { ...data, postal_code: 1000 }, { ...data, matches: [{ state, municipality, extra: 1 }] }, { ...data, matches: [{ state: { ...state, extra: 1 }, municipality }] }, { ...data, matches: [{ state, municipality: { ...municipality, extra: 1 } }] }]) expect(postalSchema.safeParse(bad).success).toBe(false);
  });
  it("maps only recognized status/code pairs, never backend messages", () => {
    for (const code of ["country_not_found", "state_not_found", "postal_code_not_found"] as const) expect(mapFailure(404, { code, error: "private" })).toBe(code);
    expect(mapFailure(400, { code: "invalid_postal_code" })).toBe("invalid_postal_code");
    expect(mapFailure(500, { code: "postal_code_not_found" })).toBe("unrecognized_response");
    expect(mapFailure(undefined)).toBe("no_response");
    expect(mapFailure(503, { code: "no_response" })).toBe("no_response");
  });
});
