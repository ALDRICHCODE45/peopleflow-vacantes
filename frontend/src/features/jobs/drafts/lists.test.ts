import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  BENEFITS,
  draftBenefitsSchema,
  draftCustomBenefitsSchema,
  draftListFieldSchemas,
  draftScreeningQuestionsSchema,
  draftSkillsSchema,
  type DraftListField,
} from "./lists";

const ok = (schema: z.ZodTypeAny, input: unknown) => schema.safeParse(input).success;
const out = (schema: z.ZodTypeAny, input: unknown) => schema.parse(input);
const issues = (schema: z.ZodTypeAny, input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues;
};

/** U+1F600: 1 codepoint, 2 UTF-16 units. */
const ASTRAL = String.fromCodePoint(0x1f600);
const NBSP = "\u00a0";
const IDEOGRAPHIC_SPACE = "\u3000";
const NEL = "\u0085";

const stringSchemas = [
  ["skills", draftSkillsSchema],
  ["custom_benefits", draftCustomBenefitsSchema],
] as const;

const items = (count: number, prefix = "item") =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

describe("draft list string schemas", () => {
  it.each(stringSchemas)("%s accepts [] and preserves submitted order", (_, schema) => {
    expect(out(schema, [])).toEqual([]);
    expect(out(schema, ["b", "a", "c"])).toEqual(["b", "a", "c"]);
  });

  it.each(stringSchemas)("%s rejects null, undefined and non-array values", (_, schema) => {
    for (const whole of [null, undefined, "a", 1, { 0: "a" }]) {
      expect(ok(schema, whole)).toBe(false);
    }
    for (const item of [null, undefined, 1, true, {}, []]) {
      expect(ok(schema, [item])).toBe(false);
    }
  });

  it.each(stringSchemas)("%s trims Unicode ends and rejects blank items", (_, schema) => {
    expect(out(schema, [` ${NBSP}a${IDEOGRAPHIC_SPACE}`, `\t${NEL}b `])).toEqual(["a", "b"]);
    expect(out(schema, ["a  b"])).toEqual(["a  b"]);
    for (const blank of ["", " ", `\t\n${NBSP}${IDEOGRAPHIC_SPACE}${NEL}`]) {
      expect(ok(schema, [blank])).toBe(false);
    }
  });

  it("preserves U+FEFF and zero-width characters, which are not White_Space", () => {
    expect(out(draftSkillsSchema, ["\ufeffa\ufeff"])).toEqual(["\ufeffa\ufeff"]);
    expect(out(draftCustomBenefitsSchema, ["\u200ba\u200b"])).toEqual(["\u200ba\u200b"]);
  });

  it.each(stringSchemas)("%s bounds each item at 200 codepoints after trimming", (_, schema) => {
    expect(ok(schema, ["a".repeat(200)])).toBe(true);
    expect(ok(schema, ["a".repeat(201)])).toBe(false);
    expect(ok(schema, [ASTRAL.repeat(200)])).toBe(true);
    expect(ok(schema, [ASTRAL.repeat(201)])).toBe(false);
    expect(ok(schema, [` ${"a".repeat(200)} `])).toBe(true);
    expect(ok(schema, [` ${"a".repeat(201)} `])).toBe(false);
  });

  it.each(stringSchemas)("%s accepts 100 items and rejects 101", (_, schema) => {
    expect(ok(schema, items(100))).toBe(true);
    expect(ok(schema, items(101))).toBe(false);
  });

  it.each(stringSchemas)("%s rejects literal duplicates after trimming by index", (_, schema) => {
    expect(ok(schema, ["a", "a"])).toBe(false);
    expect(ok(schema, ["a", ` ${NBSP}a `])).toBe(false);
    expect(issues(schema, ["a", " a "]).some((issue) => issue.path.join(".") === "1")).toBe(
      true,
    );
  });

  it("does not treat case or decomposition as duplicates (no casefold or NFC)", () => {
    expect(ok(draftSkillsSchema, ["Area", "area"])).toBe(true);
    expect(ok(draftCustomBenefitsSchema, ["e\u0301", "\u00e9"])).toBe(true);
  });
});

describe("draft benefits schema", () => {
  it("pins the exact eight contract codes in catalog order", () => {
    expect(BENEFITS).toEqual([
      "health_insurance",
      "computer_equipment",
      "flexible_schedule",
      "remote_stipend",
      "training_budget",
      "extra_time_off",
      "wellness",
      "annual_bonus",
    ]);
    expect(BENEFITS).toHaveLength(8);
  });

  it("accepts [] and every code, preserving submitted order", () => {
    expect(out(draftBenefitsSchema, [])).toEqual([]);
    expect(out(draftBenefitsSchema, [...BENEFITS])).toEqual([...BENEFITS]);
    expect(out(draftBenefitsSchema, ["wellness", "health_insurance"])).toEqual([
      "wellness",
      "health_insurance",
    ]);
  });

  it("rejects null, undefined, non-arrays and non-enum items", () => {
    for (const whole of [null, undefined, "health_insurance", 8, {}]) {
      expect(ok(draftBenefitsSchema, whole)).toBe(false);
    }
    for (const item of [null, undefined, "Health_Insurance", "health insurance", "", 1]) {
      expect(ok(draftBenefitsSchema, [item])).toBe(false);
    }
  });

  it("never trims benefit codes", () => {
    expect(ok(draftBenefitsSchema, [" health_insurance"])).toBe(false);
    expect(ok(draftBenefitsSchema, ["health_insurance "])).toBe(false);
    expect(ok(draftBenefitsSchema, [`${NBSP}wellness${NBSP}`])).toBe(false);
  });

  it("accepts 8 unique codes and rejects more or duplicated codes", () => {
    expect(ok(draftBenefitsSchema, [...BENEFITS])).toBe(true);
    expect(ok(draftBenefitsSchema, [...BENEFITS, "health_insurance"])).toBe(false);
    expect(ok(draftBenefitsSchema, ["wellness", "wellness"])).toBe(false);
    expect(ok(draftBenefitsSchema, ["wellness", "health_insurance", "wellness"])).toBe(false);
    expect(
      issues(draftBenefitsSchema, ["wellness", "wellness"]).some(
        (issue) => issue.path.join(".") === "1",
      ),
    ).toBe(true);
  });
});

describe("draft screening questions schema", () => {
  it("accepts [] and valid prompts, trimming ends and preserving order", () => {
    expect(out(draftScreeningQuestionsSchema, [])).toEqual([]);
    expect(
      out(draftScreeningQuestionsSchema, [
        { prompt: ` ${NBSP}First?${IDEOGRAPHIC_SPACE}` },
        { prompt: "\tSecond? " },
      ]),
    ).toEqual([{ prompt: "First?" }, { prompt: "Second?" }]);
    expect(out(draftScreeningQuestionsSchema, [{ prompt: "a  b" }])).toEqual([{ prompt: "a  b" }]);
  });

  it("rejects null, undefined and non-array values", () => {
    for (const whole of [null, undefined, "prompt", 1, {}]) {
      expect(ok(draftScreeningQuestionsSchema, whole)).toBe(false);
    }
  });

  it("requires a strict object containing only a string prompt", () => {
    expect(ok(draftScreeningQuestionsSchema, [{ prompt: "ok" }])).toBe(true);
    for (const item of [null, undefined, "ok", 1, {}, [], { prompt: null }, { prompt: 1 }]) {
      expect(ok(draftScreeningQuestionsSchema, [item])).toBe(false);
    }
    expect(ok(draftScreeningQuestionsSchema, [{}])).toBe(false);
    for (const extra of ["id", "answer", "knockout"]) {
      expect(ok(draftScreeningQuestionsSchema, [{ prompt: "ok", [extra]: "x" }])).toBe(false);
    }
  });

  it("rejects blank prompts but allows duplicate prompts", () => {
    for (const blank of ["", " ", `\t${NBSP}${IDEOGRAPHIC_SPACE}${NEL}`]) {
      expect(ok(draftScreeningQuestionsSchema, [{ prompt: blank }])).toBe(false);
    }
    expect(ok(draftScreeningQuestionsSchema, [{ prompt: "same?" }, { prompt: " same? " }])).toBe(
      true,
    );
    expect(
      out(draftScreeningQuestionsSchema, [{ prompt: "same?" }, { prompt: "same?" }]),
    ).toEqual([{ prompt: "same?" }, { prompt: "same?" }]);
  });

  it("bounds each prompt at 2000 codepoints after trimming", () => {
    expect(ok(draftScreeningQuestionsSchema, [{ prompt: "a".repeat(2000) }])).toBe(true);
    expect(ok(draftScreeningQuestionsSchema, [{ prompt: "a".repeat(2001) }])).toBe(false);
    expect(ok(draftScreeningQuestionsSchema, [{ prompt: ASTRAL.repeat(2000) }])).toBe(true);
    expect(ok(draftScreeningQuestionsSchema, [{ prompt: ASTRAL.repeat(2001) }])).toBe(false);
    expect(ok(draftScreeningQuestionsSchema, [{ prompt: ` ${"a".repeat(2000)} ` }])).toBe(true);
    expect(ok(draftScreeningQuestionsSchema, [{ prompt: ` ${"a".repeat(2001)} ` }])).toBe(false);
  });

  it("accepts 100 questions and rejects 101", () => {
    const questions = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ prompt: `question ${index}?` }));
    expect(ok(draftScreeningQuestionsSchema, questions(100))).toBe(true);
    expect(ok(draftScreeningQuestionsSchema, questions(101))).toBe(false);
  });
});

describe("draftListFieldSchemas map", () => {
  it("exposes exactly the four contract list fields", () => {
    expect(Object.keys(draftListFieldSchemas).sort()).toEqual([
      "benefits",
      "custom_benefits",
      "screening_questions",
      "skills",
    ]);
  });

  it("maps each field to a schema that rejects null and undefined but accepts []", () => {
    for (const schema of Object.values(draftListFieldSchemas)) {
      expect(ok(schema, null)).toBe(false);
      expect(ok(schema, undefined)).toBe(false);
      expect(ok(schema, [])).toBe(true);
    }
  });
});

describe("draft list types", () => {
  it("keeps string arrays and exact benefit literals in and out", () => {
    expectTypeOf<z.input<typeof draftSkillsSchema>>().toEqualTypeOf<string[]>();
    expectTypeOf<z.output<typeof draftSkillsSchema>>().toEqualTypeOf<string[]>();
    expectTypeOf<DraftListField>().toEqualTypeOf<
      "skills" | "custom_benefits" | "benefits" | "screening_questions"
    >();
  });
});
