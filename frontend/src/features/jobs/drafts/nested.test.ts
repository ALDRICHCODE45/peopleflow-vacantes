import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  draftLanguagesSchema,
  draftNestedFieldSchemas,
  draftRequesterSchema,
  LANGUAGE_CODES,
  LANGUAGE_LEVELS,
  REQUESTER_KINDS,
  type DraftLanguage,
  type DraftNestedField,
  type DraftRequester,
} from "./nested";

const ok = (schema: z.ZodTypeAny, input: unknown) => schema.safeParse(input).success;
const out = (schema: z.ZodTypeAny, input: unknown) => schema.parse(input);

/** U+1F600: 1 codepoint, 2 UTF-16 units. */
const ASTRAL = String.fromCodePoint(0x1f600);
const NEL = "\u0085";
const NBSP = "\u00a0";
const IDEOGRAPHIC_SPACE = "\u3000";
const FEFF = "\ufeff";
const ZERO_WIDTH = "\u200b";

const UUID = "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11";
const LOWER_UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

const language = (overrides: Record<string, unknown> = {}) => ({
  language: "other",
  custom_name: null,
  level: null,
  ...overrides,
});
const languages = (count: number) => Array.from({ length: count }, () => language());

describe("draft requester schema", () => {
  it("accepts null and both exact kinds with a null or UUID id", () => {
    expect(out(draftRequesterSchema, null)).toBeNull();
    expect(out(draftRequesterSchema, { kind: "internal_area", id: null })).toEqual({
      kind: "internal_area",
      id: null,
    });
    expect(out(draftRequesterSchema, { kind: "client", id: UUID })).toEqual({
      kind: "client",
      id: UUID,
    });
  });

  it("preserves a valid UUID exactly, without lowercasing or canonicalizing", () => {
    expect(out(draftRequesterSchema, { kind: "client", id: UUID }).id).toBe(UUID);
    expect(out(draftRequesterSchema, { kind: "client", id: LOWER_UUID }).id).toBe(LOWER_UUID);
  });

  it("requires both keys and rejects undefined, missing, wrong enum and wrong kind", () => {
    for (const bad of [
      undefined,
      {},
      { kind: "internal_area" },
      { id: null },
      { kind: "internal", id: null },
      { kind: "Internal_Area", id: null },
      { kind: "other", id: null },
      { kind: 1, id: null },
      { kind: null, id: null },
    ]) {
      expect(ok(draftRequesterSchema, bad)).toBe(false);
    }
  });

  it("rejects non-UUID, empty, quoted-null, padded and non-string ids without trimming", () => {
    for (const id of [
      "",
      "not-a-uuid",
      "null",
      `  ${UUID}  `,
      `${UUID} `,
      UUID.replace(/-/g, ""),
      UUID.slice(0, -1),
      1,
      true,
      {},
    ]) {
      expect(ok(draftRequesterSchema, { kind: "client", id })).toBe(false);
    }
  });

  it("rejects the derived read-only name and every unknown key", () => {
    for (const extra of ["name", "organization", "label", "kindName"]) {
      expect(ok(draftRequesterSchema, { kind: "client", id: null, [extra]: "x" })).toBe(false);
    }
  });
});

describe("draft languages schema", () => {
  it("accepts [] and preserves submitted order and duplicate entries", () => {
    expect(out(draftLanguagesSchema, [])).toEqual([]);
    const items = [language({ language: "en" }), language({ language: "en" })];
    expect(out(draftLanguagesSchema, items)).toEqual(items);
  });

  it("accepts the three language codes and four levels plus null", () => {
    for (const code of LANGUAGE_CODES) {
      expect(ok(draftLanguagesSchema, [language({ language: code })])).toBe(true);
    }
    for (const level of [...LANGUAGE_LEVELS, null]) {
      expect(ok(draftLanguagesSchema, [language({ level })])).toBe(true);
    }
  });

  it("rejects wrong case, padded and blank enum codes without trimming", () => {
    for (const code of ["ES", "En", "OTHER", " es ", "es ", ""]) {
      expect(ok(draftLanguagesSchema, [language({ language: code })])).toBe(false);
    }
    for (const level of ["Basic", "NATIVE", " basic ", ""]) {
      expect(ok(draftLanguagesSchema, [language({ level })])).toBe(false);
    }
  });

  it("rejects null/undefined lists, primitives and incomplete objects", () => {
    for (const whole of [null, undefined, "es", 1, {}]) {
      expect(ok(draftLanguagesSchema, whole)).toBe(false);
    }
    for (const item of [
      null,
      undefined,
      "es",
      1,
      {},
      { language: "other" },
      { custom_name: null, level: null },
      { language: "other", level: null },
      { language: "other", custom_name: null },
    ]) {
      expect(ok(draftLanguagesSchema, [item])).toBe(false);
    }
  });

  it("rejects unknown keys on a language item", () => {
    for (const extra of ["name", "proficiency", "cefr", "id"]) {
      expect(ok(draftLanguagesSchema, [language({ [extra]: "x" })])).toBe(false);
    }
  });

  it("normalizes custom_name ends only, empty to null, preserving interior and non-White_Space", () => {
    expect(
      out(draftLanguagesSchema, [language({ custom_name: ` ${NBSP}Klingon${IDEOGRAPHIC_SPACE}` })]),
    ).toEqual([language({ custom_name: "Klingon" })]);
    expect(out(draftLanguagesSchema, [language({ custom_name: `${NEL}Klingon${NEL}` })])).toEqual([
      language({ custom_name: "Klingon" }),
    ]);
    expect(out(draftLanguagesSchema, [language({ custom_name: "a  b" })])).toEqual([
      language({ custom_name: "a  b" }),
    ]);
    expect(out(draftLanguagesSchema, [language({ custom_name: `${FEFF}a${ZERO_WIDTH}` })])).toEqual(
      [language({ custom_name: `${FEFF}a${ZERO_WIDTH}` })],
    );
  });

  it("does not apply NFC: decomposed and composed names stay distinct", () => {
    const decomposed = "e\u0301";
    const composed = "\u00e9";
    expect(out(draftLanguagesSchema, [language({ custom_name: decomposed })])).toEqual([
      language({ custom_name: decomposed }),
    ]);
    expect(out(draftLanguagesSchema, [language({ custom_name: composed })])).toEqual([
      language({ custom_name: composed }),
    ]);
  });

  it("bounds custom_name at 200 codepoints after trimming", () => {
    expect(ok(draftLanguagesSchema, [language({ custom_name: "a".repeat(200) })])).toBe(true);
    expect(ok(draftLanguagesSchema, [language({ custom_name: "a".repeat(201) })])).toBe(false);
    expect(ok(draftLanguagesSchema, [language({ custom_name: ASTRAL.repeat(200) })])).toBe(true);
    expect(ok(draftLanguagesSchema, [language({ custom_name: ASTRAL.repeat(201) })])).toBe(false);
    expect(ok(draftLanguagesSchema, [language({ custom_name: ` ${"a".repeat(200)} ` })])).toBe(true);
    expect(ok(draftLanguagesSchema, [language({ custom_name: ` ${"a".repeat(201)} ` })])).toBe(
      false,
    );
  });

  it("rejects a substantive custom_name for es/en but allows null and blank", () => {
    for (const code of ["es", "en"]) {
      expect(ok(draftLanguagesSchema, [language({ language: code, custom_name: "Spanish" })])).toBe(
        false,
      );
      expect(ok(draftLanguagesSchema, [language({ language: code, custom_name: null })])).toBe(true);
      expect(ok(draftLanguagesSchema, [language({ language: code, custom_name: "" })])).toBe(true);
      expect(
        ok(draftLanguagesSchema, [language({ language: code, custom_name: `\t${NBSP}${NEL}` })]),
      ).toBe(true);
      expect(
        out(draftLanguagesSchema, [language({ language: code, custom_name: "  " })]),
      ).toEqual([language({ language: code, custom_name: null })]);
    }
  });

  it("allows other with a custom name or without one", () => {
    expect(ok(draftLanguagesSchema, [language({ language: "other", custom_name: "Klingon" })])).toBe(
      true,
    );
    expect(
      out(draftLanguagesSchema, [language({ language: "other", custom_name: "Klingon" })]),
    ).toEqual([language({ language: "other", custom_name: "Klingon" })]);
    expect(out(draftLanguagesSchema, [language({ language: "other", custom_name: null })])).toEqual([
      language({ language: "other", custom_name: null }),
    ]);
  });

  it("rejects non-string custom_name values and never defaults them", () => {
    for (const custom_name of [1, true, {}, [], undefined]) {
      expect(ok(draftLanguagesSchema, [language({ custom_name })])).toBe(false);
    }
  });

  it("accepts 100 languages and rejects 101", () => {
    expect(ok(draftLanguagesSchema, languages(100))).toBe(true);
    expect(ok(draftLanguagesSchema, languages(101))).toBe(false);
  });
});

describe("draft nested catalogs, map and types", () => {
  it("pins the exact requester kinds and language catalogs", () => {
    expect(REQUESTER_KINDS).toEqual(["internal_area", "client"]);
    expect(LANGUAGE_CODES).toEqual(["es", "en", "other"]);
    expect(LANGUAGE_LEVELS).toEqual(["basic", "intermediate", "advanced", "native"]);
  });

  it("exposes exactly the two nested write fields", () => {
    expect(Object.keys(draftNestedFieldSchemas).sort()).toEqual(["languages", "requester"]);
    expect(draftNestedFieldSchemas.requester).toBe(draftRequesterSchema);
    expect(draftNestedFieldSchemas.languages).toBe(draftLanguagesSchema);
  });

  it("keeps requester and language output types", () => {
    expectTypeOf<z.input<typeof draftRequesterSchema>>().toEqualTypeOf<DraftRequester>();
    expectTypeOf<DraftRequester>().toEqualTypeOf<
      { kind: "internal_area" | "client"; id: string | null } | null
    >();
    expectTypeOf<DraftLanguage>().toEqualTypeOf<{
      language: "es" | "en" | "other";
      custom_name: string | null;
      level: "basic" | "intermediate" | "advanced" | "native" | null;
    }>();
    expectTypeOf<DraftNestedField>().toEqualTypeOf<"requester" | "languages">();
  });
});
