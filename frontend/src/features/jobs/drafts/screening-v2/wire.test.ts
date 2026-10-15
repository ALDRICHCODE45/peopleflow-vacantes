import { describe, expect, it } from "vitest";

import { draftPatchBodySchema, draftPostBodySchema } from "../fields";
import type { LocalDraftV2Snapshot } from "../ui/draft-screening-v2-state";
import {
  draftV2PatchBodyFromChangedKeys,
  draftV2PatchBodySchema,
  draftV2PostBodySchema,
  draftV2SnapshotToPatchBody,
  draftV2SnapshotToPostBody,
  type DraftV2PatchBody,
  type DraftV2PostBody,
} from "./wire";

/**
 * Behavioral tests for the additive v2 write DTO and the local-snapshot
 * adapter (`docs/contracts/private-vacancy-drafts-v2-screening.md` §3).
 *
 * The v2 question grammar itself is owned by `./model.test.ts`; this suite only
 * covers the write-body composition boundaries, so it deliberately does not
 * duplicate the whole grammar. The v1 write schemas stay untouched and are
 * exercised here only for an explicit cross-version compatibility assertion.
 */

/** Deterministic UUIDv4: version nibble `4`, RFC 4122 variant `8`. */
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const option = (n: number, label: string) => ({ id: uuid(n), label });

const openQuestion = () => ({
  id: uuid(1),
  type: "open" as const,
  prompt: "Describe un proyecto del que estés orgulloso.",
});

const informativeQuestion = (
  options = [option(100, "Remoto"), option(101, "Híbrido")],
  id = 2,
) => ({
  id: uuid(id),
  type: "single_choice_informative" as const,
  prompt: "¿Qué modalidad de trabajo prefieres?",
  options,
});

const evaluatedOptions = () => [option(200, "func"), option(201, "function")];

const evaluatedQuestion = () => {
  const options = evaluatedOptions();
  return {
    id: uuid(3),
    type: "single_choice_evaluated" as const,
    prompt: "¿Qué palabra clave declara una función en Go?",
    options,
    correct_option_id: options[0]?.id ?? "",
  };
};

const threeVariants = () => [openQuestion(), informativeQuestion(), evaluatedQuestion()];

/** `count` distinct options with deterministic ids and labels. */
const optionsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => option(1000 + index, `Opción ${index}`));

/** Exactly 200 codepoints, distinct per `suffix` for i < 26. */
const label200 = (suffix: number) => "a".repeat(199) + String.fromCharCode(97 + suffix);

const postBody = (screening_questions: unknown) => ({ fields: { screening_questions } });
const patchBody = (screening_questions: unknown) => ({ fields: { screening_questions } });

const acceptsPost = (input: unknown) => draftV2PostBodySchema.safeParse(input).success;
const acceptsPatch = (input: unknown) => draftV2PatchBodySchema.safeParse(input).success;

const snapshotFields = (): LocalDraftV2Snapshot["fields"] => ({
  title: null,
  location: null,
  work_mode: null,
  work_schedule: null,
  contract_type: null,
  seniority: null,
  professional_area: null,
  required_requirements: null,
  preferred_requirements: null,
  skills: [],
  custom_benefits: [],
  benefits: [],
  requester: null,
  languages: [],
  compensation: {
    mode: null,
    amount: null,
    min: null,
    max: null,
    currency: "MXN",
    pay_period: "monthly",
    basis: null,
    public_visible: false,
  },
  description: null,
});

type SnapshotOverrides = {
  fields?: Partial<LocalDraftV2Snapshot["fields"]>;
  screening_questions?: LocalDraftV2Snapshot["screening_questions"];
  requesterName?: string | null;
  descriptionPlain?: string | null;
};

/** Local snapshot layout of `ui/draft-screening-v2-state.ts`, unchanged. */
const snapshot = (overrides: SnapshotOverrides = {}): LocalDraftV2Snapshot => ({
  fields: { ...snapshotFields(), ...(overrides.fields ?? {}) },
  screening_questions: overrides.screening_questions ?? [],
  requesterName: overrides.requesterName ?? null,
  descriptionPlain: overrides.descriptionPlain ?? null,
});

describe("draftV2PostBodySchema composition", () => {
  it("accepts the three v2 variants, preserving ids, order and the answer key", () => {
    const questions = threeVariants();
    const body = draftV2PostBodySchema.parse(postBody(questions));
    expect(body.fields.screening_questions).toStrictEqual(questions);
    expect(body.fields.screening_questions.map((question) => question.id)).toStrictEqual([
      uuid(1),
      uuid(2),
      uuid(3),
    ]);
    const evaluated = body.fields.screening_questions[2];
    expect(evaluated).toHaveProperty("correct_option_id", uuid(200));
  });

  it("preserves the exact UUID byte spelling of submitted ids", () => {
    const upper = "00000000-0000-4000-8000-00000000000A";
    const upperOption = "00000000-0000-4000-8000-00000000000B";
    const body = draftV2PostBodySchema.parse(
      postBody([
        {
          id: upper,
          type: "single_choice_evaluated",
          prompt: "¿Mayúsculas?",
          options: [option(100, "Sí"), { id: upperOption, label: "No" }],
          correct_option_id: upperOption,
        },
      ]),
    );
    expect(body.fields.screening_questions[0]?.id).toBe(upper);
    const [question] = body.fields.screening_questions;
    expect(question?.type === "single_choice_evaluated" && question.options[1]?.id).toBe(upperOption);
  });

  it("fills exactly the 17 writable fields with fresh v1 defaults on omission", () => {
    const body = draftV2PostBodySchema.parse({ fields: {} });
    expect(body.fields).toStrictEqual({
      title: null,
      location: null,
      work_mode: null,
      work_schedule: null,
      contract_type: null,
      seniority: null,
      professional_area: null,
      required_requirements: null,
      preferred_requirements: null,
      skills: [],
      custom_benefits: [],
      benefits: [],
      screening_questions: [],
      requester: null,
      languages: [],
      compensation: {
        mode: null,
        amount: null,
        min: null,
        max: null,
        currency: "MXN",
        pay_period: "monthly",
        basis: null,
        public_visible: false,
      },
      description: null,
    });
    expect(Object.keys(body.fields)).toHaveLength(17);
  });

  it("matches the v1 POST defaults for every shared field", () => {
    const v1 = draftPostBodySchema.parse({ fields: {} }).fields;
    const v2 = draftV2PostBodySchema.parse({ fields: {} }).fields;
    for (const key of Object.keys(v1) as (keyof typeof v1)[]) {
      expect(v2[key]).toStrictEqual(v1[key]);
    }
  });

  it("returns independent defaults for every POST parse", () => {
    const first = draftV2PostBodySchema.parse({ fields: {} });
    const second = draftV2PostBodySchema.parse({ fields: {} });
    expect(first.fields.screening_questions).not.toBe(second.fields.screening_questions);
    expect(first.fields.compensation).not.toBe(second.fields.compensation);
    expect(first.fields.skills).not.toBe(second.fields.skills);
  });

  it("keeps the defaulted fields beside a supplied v2 screening list", () => {
    const questions = threeVariants();
    const body = draftV2PostBodySchema.parse(postBody(questions));
    expect(body.fields.screening_questions).toStrictEqual(questions);
    expect(body.fields.title).toBeNull();
    expect(body.fields.compensation).toStrictEqual(snapshotFields().compensation);
  });

  it("still validates the 16 non-screening fields through the v1 rules", () => {
    expect(acceptsPost({ fields: { title: " Backend Go " } })).toBe(true);
    expect(draftV2PostBodySchema.parse({ fields: { title: " Backend Go " } }).fields.title).toBe(
      "Backend Go",
    );
    expect(acceptsPost({ fields: { title: "x".repeat(201) } })).toBe(false);
    expect(acceptsPost({ fields: { description_plain: null } })).toBe(false);
    expect(acceptsPost({ fields: { requester: { kind: "client", id: null, name: "derived" } } })).toBe(
      false,
    );
  });
});

describe("draftV2PostBodySchema and draftV2PatchBodySchema strict root", () => {
  it.each([
    undefined,
    null,
    [],
    {},
    { fields: undefined },
    { fields: null },
    { fields: [] },
    { fields: "invalid" },
    { fields: {} , schema_version: 2 },
    { fields: {}, version: "1" },
    { fields: {}, id: uuid(1) },
    { fields: {}, requesterName: "derived" },
    { fields: {}, descriptionPlain: "derived" },
    { fields: {}, status: "draft" },
  ])("rejects malformed or expanded envelope %#", (input) => {
    expect(acceptsPost(input)).toBe(false);
    expect(acceptsPatch(input)).toBe(false);
  });

  it("rejects explicit undefined on POST and PATCH", () => {
    expect(acceptsPost({ fields: { title: "valid", screening_questions: undefined } })).toBe(false);
    expect(acceptsPatch({ fields: { title: "valid", screening_questions: undefined } })).toBe(false);
    expect(acceptsPost({ fields: { title: "valid", compensation: undefined } })).toBe(false);
    expect(acceptsPatch({ fields: { title: "valid", compensation: undefined } })).toBe(false);
  });
});

describe("v2 screening item boundaries inside the write bodies", () => {
  it.each([
    [1, false],
    [2, true],
    [8, true],
    [9, false],
  ])("options length %i → accepted=%s", (count, accepted) => {
    const questions = [informativeQuestion(optionsOf(count))];
    expect(acceptsPost(postBody(questions))).toBe(accepted);
    expect(acceptsPatch(patchBody(questions))).toBe(accepted);
  });

  it("accepts 200-codepoint labels including astral characters and trims first", () => {
    const astral200 = "\u{1F600}".repeat(200);
    const questions = [
      informativeQuestion([option(100, label200(0)), option(101, astral200)]),
      informativeQuestion([option(102, ` \u3000${label200(1)}\u202f `), option(103, "Corto")], 4),
    ];
    const body = draftV2PatchBodySchema.parse(patchBody(questions));
    const first = body.fields.screening_questions?.[0];
    expect(first?.type === "single_choice_informative" && first.options[1]?.label).toBe(astral200);
    const second = body.fields.screening_questions?.[1];
    expect(second?.type === "single_choice_informative" && second.options[0]?.label).toBe(label200(1));
  });

  it("rejects 201-codepoint labels after trimming", () => {
    const questions = [informativeQuestion([option(100, "a".repeat(201)), option(101, "Corto")])];
    expect(acceptsPost(postBody(questions))).toBe(false);
    expect(acceptsPatch(patchBody(questions))).toBe(false);
    const padded = [informativeQuestion([option(100, ` ${"a".repeat(201)} `), option(101, "Corto")])];
    expect(acceptsPost(postBody(padded))).toBe(false);
  });

  it.each([
    ["unknown type", { ...openQuestion(), type: "ranking" }],
    ["unknown question key", { ...openQuestion(), score: 3 }],
    ["missing required prompt", { id: uuid(1), type: "open" }],
    ["unknown required prompt as null", { ...openQuestion(), prompt: null }],
    ["missing required id", { type: "open", prompt: "Sin id" }],
    ["open carrying options", { ...openQuestion(), options: [option(1, "a"), option(2, "b")] }],
    ["open carrying an answer key", { ...openQuestion(), correct_option_id: uuid(1) }],
    ["informative carrying an answer key", { ...informativeQuestion(), correct_option_id: uuid(100) }],
    ["informative carrying a null answer key", { ...informativeQuestion(), correct_option_id: null }],
    ["evaluated carrying a null answer key", { ...evaluatedQuestion(), correct_option_id: null }],
    ["evaluated answer key outside options", { ...evaluatedQuestion(), correct_option_id: uuid(999) }],
    [
      "unknown option key",
      {
        id: uuid(2),
        type: "single_choice_informative",
        prompt: "¿Qué modalidad de trabajo prefieres?",
        options: [{ id: uuid(100), label: "Remoto", weight: 1 }, option(101, "Híbrido")],
      },
    ],
    [
      "missing option label",
      {
        id: uuid(2),
        type: "single_choice_informative",
        prompt: "¿Qué modalidad de trabajo prefieres?",
        options: [{ id: uuid(100) }, option(101, "Híbrido")],
      },
    ],
    ["v1 prompt-only item", { prompt: "¿Por qué?" }],
  ])("rejects %s on both write bodies", (_name, question) => {
    expect(acceptsPost(postBody([question]))).toBe(false);
    expect(acceptsPatch(patchBody([question]))).toBe(false);
  });

  it("does not mutate the submitted write body", () => {
    const fields = { screening_questions: threeVariants(), title: "  Backend Go  " };
    const body = { fields };
    const frozen = structuredClone(body);
    draftV2PostBodySchema.parse(body);
    expect(body).toStrictEqual(frozen);
  });
});

describe("PATCH presence, replacement and empty_patch", () => {
  it("retains exactly the supplied keys without POST defaults", () => {
    const parsed = draftV2PatchBodySchema.parse({
      fields: { title: " x ", screening_questions: [openQuestion()] },
    });
    expect(Object.keys(parsed.fields).sort()).toStrictEqual(["screening_questions", "title"]);
    expect(parsed.fields.title).toBe("x");
    expect(parsed.fields).not.toHaveProperty("skills");
    expect(parsed.fields).not.toHaveProperty("compensation");
  });

  it("fully replaces the supplied screening list instead of merging", () => {
    const replacement = [evaluatedQuestion()];
    const parsed = draftV2PatchBodySchema.parse({ fields: { screening_questions: replacement } });
    expect(parsed.fields.screening_questions).toStrictEqual(replacement);
    expect(parsed.fields.screening_questions).toHaveLength(1);
  });

  it("accepts an explicitly emptied screening list as a full replacement", () => {
    const parsed = draftV2PatchBodySchema.parse({ fields: { screening_questions: [] } });
    expect(parsed.fields).toStrictEqual({ screening_questions: [] });
  });

  it("requires complete nested replacements without partial merging", () => {
    expect(acceptsPatch({ fields: { compensation: { currency: "USD" } } })).toBe(false);
    expect(acceptsPatch({ fields: { requester: { kind: "client" } } })).toBe(false);
    expect(acceptsPatch({ fields: { description: { schema_version: 1 } } })).toBe(false);
  });

  it("rejects an empty PATCH with the empty_patch discriminator", () => {
    const result = draftV2PatchBodySchema.safeParse({ fields: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ path: ["fields"], message: "empty_patch" }),
    );
  });
});

describe("local snapshot adapter", () => {
  it("maps the snapshot layout onto a complete POST body without derived values", () => {
    const questions = threeVariants();
    const body: DraftV2PostBody = draftV2SnapshotToPostBody(
      snapshot({
        fields: { title: " Backend Go ", professional_area: "technology_systems" },
        screening_questions: questions,
        requesterName: "Ana",
        descriptionPlain: "Texto derivado",
      }),
    );
    expect(Object.keys(body)).toStrictEqual(["fields"]);
    expect(Object.keys(body.fields)).toHaveLength(17);
    expect(body.fields.title).toBe("Backend Go");
    expect(body.fields.screening_questions).toStrictEqual(questions);
    expect(body.fields).not.toHaveProperty("requesterName");
    expect(body.fields).not.toHaveProperty("description_plain");
    expect(body.fields).not.toHaveProperty("descriptionPlain");
  });

  it("maps the snapshot onto a complete PATCH body with all 17 keys", () => {
    const body: DraftV2PatchBody = draftV2SnapshotToPatchBody(
      snapshot({ screening_questions: [openQuestion()] }),
    );
    expect(Object.keys(body.fields).sort()).toStrictEqual(
      Object.keys(draftV2PostBodySchema.parse({ fields: {} }).fields).sort(),
    );
    expect(body.fields.screening_questions).toStrictEqual([openQuestion()]);
  });

  it("preserves UUID spelling, question order, option order and the answer key", () => {
    const body = draftV2SnapshotToPostBody(snapshot({ screening_questions: threeVariants() }));
    expect(body.fields.screening_questions.map((question) => question.id)).toStrictEqual([
      uuid(1),
      uuid(2),
      uuid(3),
    ]);
    const evaluated = body.fields.screening_questions[2];
    expect(evaluated?.type === "single_choice_evaluated" && evaluated.options.map((o) => o.id)).toStrictEqual([
      uuid(200),
      uuid(201),
    ]);
    expect(evaluated).toHaveProperty("correct_option_id", uuid(200));
  });

  it("validates the snapshot at runtime instead of trusting the type", () => {
    const unknownField = {
      ...snapshot(),
      fields: { ...snapshotFields(), screening_questions: [] },
    } as unknown as LocalDraftV2Snapshot;
    expect(() => draftV2SnapshotToPostBody(unknownField)).toThrow();
    expect(() => draftV2SnapshotToPatchBody(unknownField)).toThrow();

    const unversionedField = {
      ...snapshot(),
      fields: { ...snapshotFields(), version: "1" },
    } as unknown as LocalDraftV2Snapshot;
    expect(() => draftV2SnapshotToPostBody(unversionedField)).toThrow();

    const malformedQuestions = {
      ...snapshot(),
      screening_questions: [{ prompt: "v1 only" }],
    } as unknown as LocalDraftV2Snapshot;
    expect(() => draftV2SnapshotToPostBody(malformedQuestions)).toThrow();

    const extraRoot = {
      ...snapshot(),
      schema_version: 2,
    } as unknown as LocalDraftV2Snapshot;
    expect(() => draftV2SnapshotToPostBody(extraRoot)).toThrow();
  });

  it("never mutates the snapshot and returns detached structures", () => {
    const source = snapshot({
      fields: { skills: [" Go ", "SQL"], title: " Backend Go " },
      screening_questions: threeVariants(),
    });
    const frozen = structuredClone(source);
    const body = draftV2SnapshotToPostBody(source);
    expect(source).toStrictEqual(frozen);
    expect(body.fields).not.toBe(source.fields);
    expect(body.fields.screening_questions).not.toBe(source.screening_questions);
    expect(body.fields.skills).not.toBe(source.fields.skills);
  });

  it("builds a PATCH body from an explicit changed-key list and rejects invalid keys", () => {
    const source = snapshot({
      fields: { title: "Backend Go" },
      screening_questions: [openQuestion()],
    });
    const parsed = draftV2PatchBodyFromChangedKeys(source, ["screening_questions", "title"]);
    expect(Object.keys(parsed.fields).sort()).toStrictEqual(["screening_questions", "title"]);
    expect(parsed.fields.screening_questions).toStrictEqual([openQuestion()]);

    expect(() => draftV2PatchBodyFromChangedKeys(source, [])).toThrow();
    expect(() => draftV2PatchBodyFromChangedKeys(source, ["title", "unknown_key"])).toThrow();
    expect(() => draftV2PatchBodyFromChangedKeys(source, ["description_plain"])).toThrow();
  });
});

describe("v1 compatibility assertion", () => {
  it("keeps the v1 write schema on exactly the v1 prompt-only screening shape", () => {
    const v1Body = { fields: { screening_questions: [{ prompt: " ¿Por qué? " }] } };
    expect(draftPostBodySchema.parse(v1Body).fields.screening_questions).toStrictEqual([
      { prompt: "¿Por qué?" },
    ]);
    expect(draftPatchBodySchema.parse(v1Body).fields.screening_questions).toStrictEqual([
      { prompt: "¿Por qué?" },
    ]);
  });

  it("keeps v1 and v2 screening items mutually exclusive across versions", () => {
    const typedQuestion = openQuestion();
    expect(acceptsPost(postBody([typedQuestion]))).toBe(true);
    expect(draftPostBodySchema.safeParse(postBody([typedQuestion])).success).toBe(false);
    expect(draftV2PostBodySchema.safeParse(postBody([{ prompt: "¿Por qué?" }])).success).toBe(false);
  });

  it("keeps the v1 root free of any v2 marker and the v2 root free of a write version", () => {
    expect(draftPostBodySchema.safeParse({ fields: {}, schema_version: 2 }).success).toBe(false);
    expect(acceptsPost({ fields: {}, schema_version: 2 })).toBe(false);
    expect(draftPostBodySchema.safeParse({ fields: {} }).success).toBe(true);
  });
});
