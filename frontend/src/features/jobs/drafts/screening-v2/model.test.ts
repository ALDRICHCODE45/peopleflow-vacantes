import { describe, expect, expectTypeOf, it } from "vitest";
import { ZodError } from "zod";

import {
  screeningQuestionsV2Schema,
  toCandidateScreeningQuestions,
  type CandidateScreeningQuestion,
  type ScreeningQuestionV2,
} from "./model";

const ok = (input: unknown) => screeningQuestionsV2Schema.safeParse(input).success;
const out = (input: unknown) => screeningQuestionsV2Schema.parse(input);

/** U+1F600: 1 codepoint, 2 UTF-16 units. */
const ASTRAL = String.fromCodePoint(0x1f600);
const NBSP = "\u00a0";
const IDEOGRAPHIC_SPACE = "\u3000";
const NEL = "\u0085";

/** Deterministic UUIDv4 strings: version nibble 4, RFC 4122 variant 8. */
const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const option = (n: number, label: string) => ({ id: uuid(n), label });

const open = (id: number, prompt = "¿Pregunta abierta?") => ({
  id: uuid(id),
  type: "open" as const,
  prompt,
});

const informative = (
  id: number,
  options = [option(100, "Sí"), option(101, "No")],
  prompt = "¿Informativa?",
) => ({
  id: uuid(id),
  type: "single_choice_informative" as const,
  prompt,
  options,
});

const evaluated = (
  id: number,
  options = [option(200, "func"), option(201, "function")],
  correctOptionId = options[0].id,
  prompt = "¿Evaluada?",
) => ({
  id: uuid(id),
  type: "single_choice_evaluated" as const,
  prompt,
  options,
  correct_option_id: correctOptionId,
});

/** First parsed question, narrowed to a variant that carries `options`. */
const firstChoice = (input: unknown) => {
  const [first] = out(input);
  if (!first || first.type === "open") throw new Error("expected a single-choice question");
  return first;
};

describe("screeningQuestionsV2Schema accepted shapes", () => {
  it("accepts an empty questionnaire", () => {
    expect(out([])).toEqual([]);
  });

  it("accepts one instance of every variant, preserving IDs and order", () => {
    const questions = [open(1), informative(2), evaluated(3)];
    expect(out(questions)).toEqual(questions);
    expect(out(questions).map((question) => question.id)).toEqual([
      uuid(1),
      uuid(2),
      uuid(3),
    ]);
  });

  it("trims prompt and label at Unicode ends without collapsing interior spaces", () => {
    const questions = [
      informative(
        4,
        [
          option(10, ` ${NBSP}Remoto${IDEOGRAPHIC_SPACE}`),
          option(11, `\tHíbrido${NEL}`),
        ],
        ` ${NBSP}Modalidad  de trabajo?${IDEOGRAPHIC_SPACE}`,
      ),
    ];
    expect(out(questions)).toEqual([
      {
        id: uuid(4),
        type: "single_choice_informative",
        prompt: "Modalidad  de trabajo?",
        options: [option(10, "Remoto"), option(11, "Híbrido")],
      },
    ]);
  });

  it("allows repeated prompts across questions", () => {
    expect(ok([open(5, "Misma pregunta"), open(6, "Misma pregunta")])).toBe(true);
  });

  it("preserves case and Unicode composition (no casefold, no NFC)", () => {
    const questions = [
      informative(7, [
        option(20, "Área"),
        option(21, "área"),
        option(22, "e\u0301"),
        option(23, "\u00e9"),
      ]),
    ];
    expect(firstChoice(questions).options).toEqual([
      option(20, "Área"),
      option(21, "área"),
      option(22, "e\u0301"),
      option(23, "\u00e9"),
    ]);
  });

  it("keeps IDs stable when questions and options are reordered", () => {
    const reorderedQuestions = [evaluated(3), open(1), informative(2)];
    expect(out(reorderedQuestions).map((question) => question.id)).toEqual([
      uuid(3),
      uuid(1),
      uuid(2),
    ]);

    const reorderedOptions = [option(201, "B"), option(200, "A")];
    const [question] = out([evaluated(9, reorderedOptions, uuid(201))]);
    expect(question.type).toBe("single_choice_evaluated");
    if (question.type !== "single_choice_evaluated") throw new Error("expected evaluated");
    expect(question.options.map((item) => item.id)).toEqual([uuid(201), uuid(200)]);
    expect(question.correct_option_id).toBe(uuid(201));
  });

  it("accepts 100 questions and rejects 101", () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => open(index + 1));
    expect(ok(many(100))).toBe(true);
    expect(ok(many(101))).toBe(false);
  });

  it("accepts 2 and 8 options and rejects 0, 1 and 9", () => {
    for (const count of [2, 8]) {
      const options = Array.from({ length: count }, (_, index) => option(300 + index, `Opción ${index}`));
      expect(ok([informative(30, options)])).toBe(true);
    }
    for (const count of [0, 1, 9]) {
      const options = Array.from({ length: count }, (_, index) => option(400 + index, `Opción ${index}`));
      expect(ok([informative(31, options)])).toBe(false);
    }
  });

  it("bounds the prompt at 2000 codepoints after trimming", () => {
    expect(ok([open(40, "a".repeat(2000))])).toBe(true);
    expect(ok([open(40, "a".repeat(2001))])).toBe(false);
    expect(ok([open(40, ASTRAL.repeat(2000))])).toBe(true);
    expect(ok([open(40, ASTRAL.repeat(2001))])).toBe(false);
    expect(ok([open(40, ` ${"a".repeat(2000)} `)])).toBe(true);
    expect(ok([open(40, ` ${"a".repeat(2001)} `)])).toBe(false);
  });

  it("bounds each label at 200 codepoints after trimming", () => {
    const withLabel = (label: string) => informative(41, [option(410, label), option(411, "b")]);
    expect(ok([withLabel("a".repeat(200))])).toBe(true);
    expect(ok([withLabel("a".repeat(201))])).toBe(false);
    expect(ok([withLabel(ASTRAL.repeat(200))])).toBe(true);
    expect(ok([withLabel(ASTRAL.repeat(201))])).toBe(false);
    expect(ok([withLabel(` ${"a".repeat(200)} `)])).toBe(true);
    expect(ok([withLabel(` ${"a".repeat(201)} `)])).toBe(false);
  });
});

describe("screeningQuestionsV2Schema rejections", () => {
  it("rejects null, undefined and non-array values", () => {
    for (const whole of [null, undefined, "question", 1, {}, { 0: open(1) }]) {
      expect(ok(whole)).toBe(false);
    }
  });

  it("rejects non-object items and unknown types without any fallback", () => {
    for (const item of [null, undefined, "open", 1, [], {}]) {
      expect(ok([item])).toBe(false);
    }
    for (const type of ["Open", "single_choice", "evaluated", "", null, 1]) {
      expect(ok([{ ...open(1), type }])).toBe(false);
    }
  });

  it.each([
    ["open", () => open(1), ["id", "type", "prompt"]],
    ["single_choice_informative", () => informative(2), ["id", "type", "prompt", "options"]],
    [
      "single_choice_evaluated",
      () => evaluated(3),
      ["id", "type", "prompt", "options", "correct_option_id"],
    ],
  ])("rejects %s missing any required key", (_name, make, keys) => {
    for (const key of keys as string[]) {
      const candidate = { ...make() } as Record<string, unknown>;
      delete candidate[key];
      expect(ok([candidate])).toBe(false);
    }
  });

  it("rejects every extra key on every variant and on options", () => {
    expect(ok([{ ...open(1), options: [option(500, "x"), option(501, "y")] }])).toBe(false);
    expect(ok([{ ...open(1), correct_option_id: uuid(500) }])).toBe(false);
    expect(ok([{ ...informative(2), correct_option_id: uuid(100) }])).toBe(false);
    expect(ok([{ ...informative(2), score: 1 }])).toBe(false);
    expect(ok([{ ...evaluated(3), knockout: true }])).toBe(false);
    const extraOptionKey = {
      ...informative(4),
      options: [{ ...option(600, "x"), weight: 1 }, option(601, "y")],
    };
    expect(ok([extraOptionKey])).toBe(false);
  });

  it("rejects a required non-null key sent as null", () => {
    expect(ok([{ ...open(1), prompt: null }])).toBe(false);
    expect(ok([{ ...informative(2), prompt: null }])).toBe(false);
    expect(ok([{ ...informative(2), options: null }])).toBe(false);
    expect(ok([{ ...evaluated(3), correct_option_id: null }])).toBe(false);
  });

  it("rejects prompts empty after trimming but keeps non-White_Space characters", () => {
    for (const blank of ["", " ", `\t\n${NBSP}${IDEOGRAPHIC_SPACE}${NEL}`]) {
      expect(ok([open(1, blank)])).toBe(false);
    }
    // U+FEFF and U+200B are not Unicode White_Space, so they survive trimming.
    expect(ok([open(1, "\ufeff")])).toBe(true);
    expect(ok([open(1, "\u200b")])).toBe(true);
  });

  it("rejects labels empty after trimming", () => {
    for (const blank of ["", " ", `\t${NBSP}${IDEOGRAPHIC_SPACE}${NEL}`]) {
      expect(ok([informative(1, [option(10, blank), option(11, "ok")])])).toBe(false);
    }
  });

  it("rejects duplicate labels after exact trim and reports the offending index", () => {
    const result = screeningQuestionsV2Schema.safeParse([
      informative(1, [option(10, " Remoto "), option(11, "Remoto")]),
    ]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected duplicate label rejection");
    expect(
      result.error.issues.some((issue) => issue.path.join(".") === "0.options.1.label"),
    ).toBe(true);
  });

  it("does not treat case or Unicode composition as duplicate labels", () => {
    expect(ok([informative(1, [option(10, "Area"), option(11, "area")])])).toBe(true);
    expect(ok([informative(1, [option(10, "e\u0301"), option(11, "\u00e9")])])).toBe(true);
  });

  it("rejects IDs that are not UUIDv4 with an RFC 4122 variant", () => {
    const invalidIds = [
      "not-a-uuid",
      "123e4567e89b42d3a456426614174000",
      "123e4567-e89b-12d3-a456-426614174000",
      "123e4567-e89b-42d3-c456-426614174000",
      "123e4567-e89b-42d3-0456-426614174000",
      `${uuid(1)} `,
    ];
    for (const id of invalidIds) {
      expect(ok([{ ...open(1), id }])).toBe(false);
    }
    expect(ok([informative(2, [{ id: "not-a-uuid", label: "x" }, option(11, "y")])])).toBe(false);
    expect(
      ok([evaluated(3, [option(200, "a"), option(201, "b")], "not-a-uuid")]),
    ).toBe(false);
  });

  it("rejects duplicate question IDs within the questionnaire", () => {
    const result = screeningQuestionsV2Schema.safeParse([open(1), open(1)]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected duplicate question ID rejection");
    expect(result.error.issues.some((issue) => issue.path.join(".") === "1.id")).toBe(true);
  });

  it("rejects question IDs that differ only by hex case", () => {
    const baseId = uuid(0xab12);
    const result = screeningQuestionsV2Schema.safeParse([
      { id: baseId, type: "open", prompt: "Primera" },
      { id: baseId.toUpperCase(), type: "open", prompt: "Segunda" },
    ]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected mixed-case question ID rejection");
    expect(result.error.issues.some((issue) => issue.path.join(".") === "1.id")).toBe(true);
  });

  it("rejects duplicate option IDs within a question", () => {
    const result = screeningQuestionsV2Schema.safeParse([
      informative(1, [option(10, "a"), option(10, "b")]),
    ]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected duplicate option ID rejection");
    expect(result.error.issues.some((issue) => issue.path.join(".") === "0.options.1.id")).toBe(
      true,
    );
  });

  it("rejects option IDs that differ only by hex case", () => {
    const optionId = uuid(10);
    const result = screeningQuestionsV2Schema.safeParse([
      informative(1, [
        { id: optionId, label: "a" },
        { id: optionId.toUpperCase(), label: "b" },
      ]),
    ]);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected mixed-case option ID rejection");
    expect(result.error.issues.some((issue) => issue.path.join(".") === "0.options.1.id")).toBe(
      true,
    );
  });

  it("preserves a non-duplicate uppercase ID verbatim", () => {
    const questionId = uuid(0xbeef).toUpperCase();
    const optionId = uuid(0xcafe).toUpperCase();
    const [question] = out([
      {
        id: questionId,
        type: "single_choice_informative",
        prompt: "P",
        options: [
          { id: optionId, label: "a" },
          { id: uuid(0xcaff).toUpperCase(), label: "b" },
        ],
      },
    ]);
    expect(question.id).toBe(questionId);
    if (question.type === "open") throw new Error("expected a single choice");
    expect(question.options.map((item) => item.id)).toEqual([
      optionId,
      uuid(0xcaff).toUpperCase(),
    ]);
  });

  it("requires correct_option_id to match exactly one option ID", () => {
    const options = [option(200, "func"), option(201, "function")];
    expect(ok([evaluated(1, options, uuid(200))])).toBe(true);
    expect(ok([evaluated(1, options, uuid(999))])).toBe(false);
  });
});

describe("model types", () => {
  it("exposes the three authoring variants and the two candidate types", () => {
    expectTypeOf<ScreeningQuestionV2["type"]>().toEqualTypeOf<
      "open" | "single_choice_informative" | "single_choice_evaluated"
    >();
    expectTypeOf<CandidateScreeningQuestion["type"]>().toEqualTypeOf<"open" | "single_choice">();
  });
});

describe("toCandidateScreeningQuestions", () => {
  it("projects every variant onto the allowlisted candidate shape", () => {
    expect(toCandidateScreeningQuestions([open(1), informative(2), evaluated(3)])).toEqual([
      { id: uuid(1), type: "open", prompt: "¿Pregunta abierta?" },
      {
        id: uuid(2),
        type: "single_choice",
        prompt: "¿Informativa?",
        options: [option(100, "Sí"), option(101, "No")],
      },
      {
        id: uuid(3),
        type: "single_choice",
        prompt: "¿Evaluada?",
        options: [option(200, "func"), option(201, "function")],
      },
    ]);
  });

  it("exposes exactly the allowlisted keys and never an answer key, flag or score", () => {
    const candidate = toCandidateScreeningQuestions([open(1), informative(2), evaluated(3)]);
    expect(Object.keys(candidate[0]).sort()).toEqual(["id", "prompt", "type"]);
    expect(Object.keys(candidate[1]).sort()).toEqual(["id", "options", "prompt", "type"]);
    expect(Object.keys(candidate[2]).sort()).toEqual(["id", "options", "prompt", "type"]);
    for (const question of candidate) {
      for (const forbidden of ["correct_option_id", "evaluated", "score", "knockout", "flag"]) {
        expect(question).not.toHaveProperty(forbidden);
      }
    }
    for (const choice of candidate.filter((question) => question.type === "single_choice")) {
      for (const item of choice.options) {
        expect(Object.keys(item).sort()).toEqual(["id", "label"]);
      }
    }
  });

  it("does not mutate the private input", () => {
    const questions = [open(1), informative(2), evaluated(3)];
    const snapshot = structuredClone(questions);
    toCandidateScreeningQuestions(questions);
    expect(questions).toStrictEqual(snapshot);
  });

  it("returns detached candidate structures", () => {
    const questions = [informative(2, [option(100, "Sí"), option(101, "No")])];
    const [first] = toCandidateScreeningQuestions(questions);
    if (first.type !== "single_choice") throw new Error("expected a single choice");
    first.options[0].label = "mutated";
    first.prompt = "mutated";
    expect(questions[0].options[0].label).toBe("Sí");
    expect(questions[0].prompt).toBe("¿Informativa?");
  });

  it("throws a ZodError for invalid private input instead of projecting it", () => {
    expect(() => toCandidateScreeningQuestions([{ id: uuid(1), type: "open" }])).toThrow(ZodError);
    expect(() =>
      toCandidateScreeningQuestions([evaluated(1, [option(200, "a"), option(201, "b")], uuid(999))]),
    ).toThrow(ZodError);
    expect(() => toCandidateScreeningQuestions(null)).toThrow(ZodError);
  });
});
