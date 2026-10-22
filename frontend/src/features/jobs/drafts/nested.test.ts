import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { CEFR_LEVELS } from "@/features/candidate/model";
import { draftLanguagesSchema, draftNestedFieldSchemas, draftRequesterSchema, REQUESTER_KINDS, type DraftLanguage, type DraftNestedField, type DraftRequester } from "./nested";
const ok = (schema: z.ZodTypeAny, input: unknown) => schema.safeParse(input).success;
const out = (schema: z.ZodTypeAny, input: unknown) => schema.parse(input);
const UUID = "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11";
const LOWER_UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
describe("draft requester schema", () => {
  it("accepts null and both exact kinds with a null or UUID id", () => {
    expect(out(draftRequesterSchema, null)).toBeNull();
    expect(out(draftRequesterSchema, { kind: "internal_area", id: null })).toEqual({ kind: "internal_area", id: null });
    expect(out(draftRequesterSchema, { kind: "client", id: UUID })).toEqual({ kind: "client", id: UUID });
  });
  it("preserves a valid UUID exactly, without lowercasing or canonicalizing", () => {
    expect(out(draftRequesterSchema, { kind: "client", id: UUID }).id).toBe(UUID);
    expect(out(draftRequesterSchema, { kind: "client", id: LOWER_UUID }).id).toBe(LOWER_UUID);
  });
  it("requires both keys and rejects undefined, missing, wrong enum and wrong kind", () => {
    for (const bad of [undefined, {}, { kind: "internal_area" }, { id: null }, { kind: "internal", id: null }, { kind: "Internal_Area", id: null }, { kind: "other", id: null }, { kind: 1, id: null }, { kind: null, id: null }]) expect(ok(draftRequesterSchema, bad)).toBe(false);
  });
  it("rejects non-UUID, empty, quoted-null, padded and non-string ids without trimming", () => {
    for (const id of ["", "not-a-uuid", "null", `  ${UUID}  `, `${UUID} `, UUID.replace(/-/g, ""), UUID.slice(0, -1), 1, true, {}]) expect(ok(draftRequesterSchema, { kind: "client", id })).toBe(false);
  });
  it("rejects the derived read-only name and every unknown key", () => {
    for (const extra of ["name", "organization", "label", "kindName"]) expect(ok(draftRequesterSchema, { kind: "client", id: null, [extra]: "x" })).toBe(false);
  });
});
describe("draft languages schema", () => {
  it("preserves empty lists and submitted opaque codes without normalization", () => {
    expect(out(draftLanguagesSchema, [])).toEqual([]);
    const items = [{ code: "qaa", min_level: "B2" }, { code: "nah", min_level: "native" }];
    expect(out(draftLanguagesSchema, items)).toEqual(items);
  });
  it.each(CEFR_LEVELS)("accepts %s", min_level => expect(ok(draftLanguagesSchema, [{ code: "en", min_level }])).toBe(true));
  it("rejects old, null, missing and extra fields without coercion", () => {
    for (const item of [null, {}, { code: "en" }, { code: "en", min_level: null }, { code: "en", min_level: "b2" }, { code: "en", min_level: " B2" }, { code: "en", min_level: "basic" }, { code: "", min_level: "B2" }, { code: "en", min_level: "B2", custom_name: null }]) expect(ok(draftLanguagesSchema, [item])).toBe(false);
    for (const value of [null, undefined, "en", {}]) expect(ok(draftLanguagesSchema, value)).toBe(false);
  });
  it("requires unique codes and at most twenty rows", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ code: `opaque${index}`, min_level: "B2" }));
    expect(ok(draftLanguagesSchema, items)).toBe(true);
    expect(ok(draftLanguagesSchema, [...items, { code: "extra", min_level: "B2" }])).toBe(false);
    const duplicate = draftLanguagesSchema.safeParse([items[0], items[0]]);
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) expect(duplicate.error.issues[0].path).toEqual([1, "code"]);
  });
});
describe("draft nested catalogs, map and types", () => {
  it("pins the requester kinds", () => expect(REQUESTER_KINDS).toEqual(["internal_area", "client"]));
  it("exposes exactly the two nested write fields", () => {
    expect(Object.keys(draftNestedFieldSchemas).sort()).toEqual(["languages", "requester"]);
    expect(draftNestedFieldSchemas.requester).toBe(draftRequesterSchema);
    expect(draftNestedFieldSchemas.languages).toBe(draftLanguagesSchema);
  });
  it("keeps requester and language output types", () => {
    expectTypeOf<z.input<typeof draftRequesterSchema>>().toEqualTypeOf<DraftRequester>();
    expectTypeOf<DraftRequester>().toEqualTypeOf<{ kind: "internal_area" | "client"; id: string | null } | null>();
    expectTypeOf<DraftLanguage>().toEqualTypeOf<{ code: string; min_level: (typeof CEFR_LEVELS)[number] }>();
    expectTypeOf<DraftNestedField>().toEqualTypeOf<"requester" | "languages">();
  });
});
