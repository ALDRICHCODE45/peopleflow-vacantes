import { describe, expect, it } from "vitest";

import { draftPostBodySchema } from "./fields";
import { draftReadEnvelopeSchema } from "./read";
import { draftReadEnvelopeV2Schema } from "./read-v2";

/**
 * Complete v2 read-envelope integration
 * (`docs/contracts/private-vacancy-drafts-v2-screening.md` §1, §3, §4.4, §5, §6).
 *
 * Question grammar and the option/prompt limits inside a question are already
 * covered by `screening-v2/model.test.ts`; this suite is intentionally focused
 * on the read envelope: the `schema_version: 2` marker, complete metadata and
 * field requirements, strict envelope/field/requester keys, inherited v1
 * metadata boundaries, derived read fields, the `ETag`-stays-outside rule and
 * v1/v2 isolation. It is a pure validator suite: no HTTP, no backend and no
 * claim that the v2 endpoint exists.
 */
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const timestamp = "2026-10-06T03:00:00.123456Z";

const EVALUATED_ID = "b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CORRECT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const INFORMATIVE_ID = "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c";
const OPEN_ID = "d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d";

const rich = () => ({
  schema_version: 1,
  document: { type: "doc", content: [{ type: "paragraph" }] },
});

const evaluatedQuestion = () => ({
  id: EVALUATED_ID,
  type: "single_choice_evaluated" as const,
  prompt: "¿Qué palabra clave declara una función en Go?",
  options: [
    { id: CORRECT_ID, label: "func" },
    { id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", label: "function" },
  ],
  correct_option_id: CORRECT_ID,
});

const informativeQuestion = () => ({
  id: INFORMATIVE_ID,
  type: "single_choice_informative" as const,
  prompt: "¿Qué modalidad de trabajo prefieres?",
  options: [
    { id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", label: "Remoto" },
    { id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70", label: "Híbrido" },
  ],
});

const openQuestion = () => ({
  id: OPEN_ID,
  type: "open" as const,
  prompt: "Describe un proyecto del que estés orgulloso.",
});

/** One instance of each approved variant; order is meaningful and asserted. */
const v2Questions = () => [openQuestion(), evaluatedQuestion(), informativeQuestion()];

const openIdFor = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const openQuestions = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: openIdFor(index + 1),
    type: "open" as const,
    prompt: `Question ${index + 1}`,
  }));

const optionsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    label: `Option ${index + 1}`,
  }));
const evaluatedWithOptions = (count: number) => {
  const options = optionsOf(count);
  return {
    id: EVALUATED_ID,
    type: "single_choice_evaluated" as const,
    prompt: "Elige una opción",
    options,
    correct_option_id: options[0]?.id,
  };
};

/** Complete v2 read envelope: required metadata plus every field, no defaults. */
const response = (questions: unknown = v2Questions()) => ({
  schema_version: 2,
  id: UUID,
  status: "draft",
  principal_recruiter_id: UUID,
  version: "1",
  created_at: timestamp,
  updated_at: timestamp,
  fields: {
    ...draftPostBodySchema.parse({ fields: {} }).fields,
    screening_questions: questions,
    description_plain: null as string | null,
  },
});

/** A complete v1 response built from the unchanged v1 parser defaults. */
const v1Response = () => ({
  schema_version: 1,
  id: UUID,
  status: "draft",
  principal_recruiter_id: UUID,
  version: "1",
  created_at: timestamp,
  updated_at: timestamp,
  fields: {
    ...draftPostBodySchema.parse({ fields: {} }).fields,
    description_plain: null as string | null,
  },
});

function rejects(input: unknown) {
  const before = structuredClone(input);
  expect(draftReadEnvelopeV2Schema.safeParse(input).success).toBe(false);
  expect(input).toStrictEqual(before);
}

describe("complete v2 private draft read envelope", () => {
  it("accepts a complete v2 envelope with all three question types without mutation or defaults", () => {
    const input = response();
    const before = structuredClone(input);
    expect(draftReadEnvelopeV2Schema.parse(input)).toStrictEqual(before);
    expect(input).toStrictEqual(before);
  });

  it("accepts an empty v2 questionnaire", () => {
    const input = response([]);
    expect(draftReadEnvelopeV2Schema.parse(input)).toStrictEqual(input);
  });

  it.each(Object.keys(response()))("requires envelope key %s", (key) => {
    const input: Record<string, unknown> = response();
    delete input[key];
    rejects(input);
  });

  it.each(Object.keys(response().fields))("requires fields.%s without read defaults", (key) => {
    const fields: Record<string, unknown> = { ...response().fields };
    delete fields[key];
    rejects({ ...response(), fields });
    rejects({ ...response(), fields: { ...fields, [key]: undefined } });
  });

  it.each(["actor", "organization", "created_by", "ETag", "unknown"])(
    "rejects extra envelope key %s",
    (key) => {
      rejects({ ...response(), [key]: "extra" });
    },
  );

  it.each(["employmentType", "closingDate", "wizardStep", "department", "unknown"])(
    "rejects extra field %s",
    (key) => {
      rejects({ ...response(), fields: { ...response().fields, [key]: "extra" } });
    },
  );

  it.each([
    { schema_version: 1 },
    { schema_version: "2" },
    { schema_version: 2.0, status: "published" },
    { status: "published" },
    { id: "not-an-id" },
    { principal_recruiter_id: "not-an-id" },
    { fields: null },
    { fields: [] },
  ])("rejects invalid metadata %#", (patch) => rejects({ ...response(), ...patch }));
});

describe("v2 screening questions inside the read envelope", () => {
  it("preserves question ID bytes, order and the correct-answer key verbatim", () => {
    const input = response([
      informativeQuestion(),
      evaluatedQuestion(),
      { ...openQuestion(), id: OPEN_ID.toUpperCase() },
    ]);
    const parsed = draftReadEnvelopeV2Schema.parse(input);
    expect(parsed.fields.screening_questions.map((question) => question.id)).toStrictEqual([
      INFORMATIVE_ID,
      EVALUATED_ID,
      OPEN_ID.toUpperCase(),
    ]);
    const evaluated = parsed.fields.screening_questions[1];
    if (evaluated.type !== "single_choice_evaluated") {
      throw new Error("expected an evaluated question at index 1");
    }
    expect(evaluated.correct_option_id).toBe(CORRECT_ID);
    expect(evaluated.options.map((option) => option.id)).toStrictEqual([
      CORRECT_ID,
      "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    ]);
  });

  it("rejects a v1 screening question shape inside a v2 envelope", () => {
    rejects({
      ...response(),
      fields: { ...response().fields, screening_questions: [{ prompt: "Only a v1 prompt" }] },
    });
  });

  it("rejects a v1 marker on the v2 read envelope", () => {
    rejects({ ...response(), schema_version: 1 });
  });

  it("rejects an evaluated correct_option_id that is not an option member", () => {
    rejects(
      response([
        { ...evaluatedQuestion(), correct_option_id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f" },
      ]),
    );
  });

  it("preserves the option-count limits between the read envelope and the questions", () => {
    expect(draftReadEnvelopeV2Schema.parse(response([evaluatedWithOptions(2)]))).toStrictEqual(
      response([evaluatedWithOptions(2)]),
    );
    expect(draftReadEnvelopeV2Schema.parse(response([evaluatedWithOptions(8)]))).toStrictEqual(
      response([evaluatedWithOptions(8)]),
    );
    rejects(response([evaluatedWithOptions(1)]));
    rejects(response([evaluatedWithOptions(9)]));
  });

  it("preserves the question-count limit between the read envelope and the questions", () => {
    expect(draftReadEnvelopeV2Schema.parse(response(openQuestions(100)))).toStrictEqual(
      response(openQuestions(100)),
    );
    rejects(response(openQuestions(101)));
  });

  it("preserves the 200/201 label and 2000/2001 prompt boundaries", () => {
    const labeled = evaluatedWithOptions(2);
    const labels = (first: string, second: string) => ({
      ...labeled,
      options: [
        { ...labeled.options[0], label: first },
        { ...labeled.options[1], label: second },
      ],
    });
    const atLabelLimit = labels("a".repeat(200), "b".repeat(200));
    expect(draftReadEnvelopeV2Schema.parse(response([atLabelLimit]))).toStrictEqual(response([atLabelLimit]));
    rejects(response([labels("a".repeat(201), "b".repeat(200))]));

    const atPromptLimit = { ...openQuestion(), prompt: "a".repeat(2000) };
    expect(draftReadEnvelopeV2Schema.parse(response([atPromptLimit]))).toStrictEqual(
      response([atPromptLimit]),
    );
    rejects(response([{ ...openQuestion(), prompt: "a".repeat(2001) }]));
  });
});

describe("v1 metadata boundaries inherited by the v2 read envelope", () => {
  it.each([0, 1, null, "", "0", "01", "-1", "+1", "1.0", "1e2", " 1", "1 ", "1\n", "١"])(
    "rejects invalid version %j",
    (version) => rejects({ ...response(), version }),
  );

  it("retains a version larger than Number.MAX_SAFE_INTEGER exactly", () => {
    const input = { ...response(), version: "90071992547409931234567890" };
    expect(draftReadEnvelopeV2Schema.parse(input)).toStrictEqual(input);
  });

  it.each([
    "2026-10-06T03:00:00Z",
    "2026-10-06T03:00:00.123Z",
    "2026-10-06T03:00:00.1234567Z",
    "2026-10-06T03:00:00.123456+00:00",
    "2026-10-06T03:00:00.123456-06:00",
    "2026-02-29T03:00:00.123456Z",
    "2026-13-01T03:00:00.123456Z",
    "2026-10-06T24:00:00.123456Z",
    "2026-10-06T03:60:00.123456Z",
    timestamp + "\n",
  ])("rejects invalid UTC microsecond timestamps %s", (value) => {
    rejects({ ...response(), created_at: value });
    rejects({ ...response(), updated_at: value });
  });

  it("accepts a leap-day timestamp without inventing chronological ordering", () => {
    const input = { ...response(), updated_at: "2024-02-29T00:00:00.000000Z" };
    expect(draftReadEnvelopeV2Schema.parse(input)).toStrictEqual(input);
  });
});

describe("v2 read derived fields", () => {
  it("accepts and preserves the required nullable requester name", () => {
    for (const name of [null, "  Área\u0301\uFEFF  ", "😀".repeat(160)]) {
      const input = {
        ...response(),
        fields: { ...response().fields, requester: { kind: "client", id: null, name } },
      };
      expect(draftReadEnvelopeV2Schema.parse(input)).toStrictEqual(input);
    }
  });

  it.each([
    { kind: "client", id: null },
    { kind: "client", id: null, name: undefined },
    { kind: "client", id: null, name: 4 },
    { kind: "client", id: null, name: "😀".repeat(161) },
    { kind: "client", name: null },
    { kind: "unknown", id: null, name: null },
    { kind: "client", id: "bad", name: null },
    { kind: "client", id: null, name: null, extra: true },
  ])("rejects an incomplete or invalid read requester %#", (requester) => {
    rejects({ ...response(), fields: { ...response().fields, requester } });
  });

  it("preserves server plain text without local recalculation and pairs it with description", () => {
    const described = {
      ...response(),
      fields: { ...response().fields, description: rich(), description_plain: "Server text\n  " },
    };
    expect(draftReadEnvelopeV2Schema.parse(described)).toStrictEqual(described);

    const emptyPlain = {
      ...described,
      fields: { ...described.fields, description_plain: "" },
    };
    expect(draftReadEnvelopeV2Schema.parse(emptyPlain)).toStrictEqual(emptyPlain);

    rejects({ ...response(), fields: { ...response().fields, description_plain: "" } });
    rejects({ ...described, fields: { ...described.fields, description_plain: null } });
  });

  it("reuses the approved field constraints, including the version-1 nested description", () => {
    rejects({ ...response(), fields: { ...response().fields, skills: null } });
    rejects({ ...response(), fields: { ...response().fields, compensation: { mode: null } } });
    rejects({
      ...response(),
      fields: {
        ...response().fields,
        description: { schema_version: 2, document: { type: "doc", content: [] } },
      },
    });
  });
});

describe("v1/v2 read isolation", () => {
  it("still accepts a complete v1 read envelope through the unchanged v1 parser", () => {
    const input = v1Response();
    expect(draftReadEnvelopeSchema.parse(input)).toStrictEqual(input);
  });

  it("rejects the v2 envelope with the unchanged v1 parser", () => {
    expect(draftReadEnvelopeSchema.safeParse(response()).success).toBe(false);
  });

  it("rejects the v1 envelope with the v2 parser", () => {
    rejects(v1Response());
  });

  it("keeps a v1 screening question valid only through the v1 parser", () => {
    // The v1 parser keeps accepting its own prompt-only screening items; the v2
    // parser must not accept them, so the isolation is asserted in both directions.
    const v1Input = {
      ...v1Response(),
      fields: { ...v1Response().fields, screening_questions: [{ prompt: "Only a v1 prompt" }] },
    };
    expect(draftReadEnvelopeSchema.parse(v1Input)).toStrictEqual(v1Input);
    rejects({
      ...response(),
      fields: {
        ...response().fields,
        screening_questions: v1Input.fields.screening_questions,
      },
    });
  });
});
