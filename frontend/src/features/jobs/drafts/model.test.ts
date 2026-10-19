import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { draftPatchBodySchema, draftPostBodySchema } from "./fields";
import { BENEFITS } from "./lists";
import type { DraftRichEnvelope } from "./rich/grammar";
import {
  createDraftModel,
  draftModelToPatchBody,
  draftModelToPostBody,
  hydrateDraftModel,
  type DraftModel,
} from "./model";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const timestamp = "2026-10-06T03:00:00.123456Z";

/** The 17 contract writable `fields` keys, in the accepted schema order. */
const WRITABLE_FIELD_KEYS = [
  "title",
  "location",
  "remote_scope",
  "work_mode",
  "work_schedule",
  "contract_type",
  "seniority",
  "professional_area",
  "required_requirements",
  "preferred_requirements",
  "skills",
  "custom_benefits",
  "benefits",
  "screening_questions",
  "requester",
  "languages",
  "compensation",
  "description",
] as const;

/** Fresh POST defaults, obtained through the accepted composition schema. */
const writeDefaults = () => draftPostBodySchema.parse({ fields: {} }).fields;

/** Complete read fields: the write defaults plus the derived plain text. */
const readFields = () => ({ ...writeDefaults(), description_plain: null as string | null });

const envelope = (
  fieldOverrides: Record<string, unknown> = {},
  envelopeOverrides: Record<string, unknown> = {},
) => ({
  schema_version: 1,
  id: ID,
  status: "draft",
  principal_recruiter_id: ID,
  version: "1",
  created_at: timestamp,
  updated_at: timestamp,
  fields: { ...readFields(), ...fieldOverrides },
  ...envelopeOverrides,
});

/** Rich description with omitted versus empty content and ordered marks. */
const rich = () => ({
  schema_version: 1 as const,
  document: {
    type: "doc" as const,
    content: [
      { type: "paragraph" as const },
      { type: "paragraph" as const, content: [] },
      {
        type: "paragraph" as const,
        content: [
          { type: "text" as const, text: "A", marks: [] },
          {
            type: "text" as const,
            text: "B",
            marks: [
              { type: "fontSizePreset" as const, attrs: { preset: "normal" as const } },
              { type: "italic" as const },
            ],
          },
          { type: "hardBreak" as const },
        ],
      },
    ],
  },
});

/** One fully populated, schema-normalized write field set. */
const populatedWriteFields = () =>
  draftPostBodySchema.parse({
    fields: {
      title: " Backend Go ",
      location: { country: "MX", state: "09" },
      work_mode: "hybrid",
      work_schedule: "full_time",
      contract_type: "indefinite",
      seniority: "senior",
      professional_area: "technology_systems",
      required_requirements: " Go ",
      preferred_requirements: " SQL ",
      skills: [" Go ", "SQL"],
      custom_benefits: [" Training "],
      benefits: ["annual_bonus", "health_insurance"],
      screening_questions: [{ prompt: " Why? " }],
      requester: { kind: "client" as const, id: ID },
      languages: [{ language: "other" as const, custom_name: " French ", level: "basic" as const }],
      compensation: {
        mode: "range" as const,
        amount: null,
        min: "30000",
        max: "45000",
        currency: "MXN" as const,
        pay_period: "monthly" as const,
        basis: "gross" as const,
        public_visible: false,
      },
      description: rich(),
    },
  }).fields;

/** A complete read envelope: normalized write fields plus server-derived text. */
const populatedEnvelope = () => ({
  ...envelope(
    {
      ...populatedWriteFields(),
      location: { country: { id: "MX", name: "México" }, state: { id: "09", name: "Ciudad de México" }, municipality: null, postal_code: null, label: "Ciudad de México" },
      requester: { kind: "client", id: ID, name: "Área No\u0301mada\uFEFF" },
      description_plain: "Server text\n  ",
    },
  ),
});

/** Narrow a non-null rich description for deep mutation assertions. */
function nonNullDescription(value: { description: unknown }): DraftRichEnvelope {
  const { description } = value;
  if (description === null) throw new Error("expected a non-null description");
  return description as DraftRichEnvelope;
}

const deleteField = (model: DraftModel, key: string): void => {
  delete (model.fields as unknown as Record<string, unknown>)[key];
};

describe("createDraftModel", () => {
  it("builds the complete 17-field default model from the accepted POST defaults", () => {
    const model = createDraftModel();
    expect(model).toStrictEqual({
      fields: writeDefaults(),
      requesterName: null,
      descriptionPlain: null,
    });
    expect(Object.keys(model.fields)).toHaveLength(18);
    expect(Object.keys(model)).toStrictEqual(["fields", "requesterName", "descriptionPlain"]);
  });

  it("keeps metadata and ETag caller-owned", () => {
    const model = createDraftModel();
    for (const key of ["id", "version", "etag", "created_at", "updated_at", "status"]) {
      expect(model).not.toHaveProperty(key);
    }
  });

  it("returns a fresh independent instance on every call", () => {
    const first = createDraftModel();
    const second = createDraftModel();
    expect(first.fields).not.toBe(second.fields);
    for (const key of [
      "skills",
      "custom_benefits",
      "benefits",
      "screening_questions",
      "languages",
      "compensation",
    ] as const) {
      expect(first.fields[key]).not.toBe(second.fields[key]);
    }

    first.fields.skills.push("mutated");
    first.fields.compensation.currency = "USD";
    expect(second.fields.skills).toStrictEqual([]);
    expect(second.fields.compensation.currency).toBe("MXN");
  });
});

describe("hydrateDraftModel", () => {
  it("projects exactly the 17 writable fields and strips server-derived text", () => {
    const model = hydrateDraftModel(populatedEnvelope());
    expect(Object.keys(model.fields)).toHaveLength(18);
    expect(model.fields).toStrictEqual(populatedWriteFields());
    expect("description_plain" in model.fields).toBe(false);
    expect(model.fields.requester).toStrictEqual({ kind: "client", id: ID });
    expect(model.fields.requester).not.toHaveProperty("name");
    expect(model.requesterName).toBe("Área No\u0301mada\uFEFF");
    expect(model.descriptionPlain).toBe("Server text\n  ");
  });

  it("preserves server-derived display text verbatim instead of recomputing it", () => {
    const model = hydrateDraftModel(populatedEnvelope());
    const derived = "Server text\n  ";
    expect(model.descriptionPlain).toBe(derived);
    expect(model.requesterName).toBe("Área No\u0301mada\uFEFF");
  });

  it("preserves absent-versus-empty rich shapes and mark order", () => {
    const model = hydrateDraftModel(populatedEnvelope());
    const description = nonNullDescription(model.fields);
    expect(description).toStrictEqual(rich());
    const blocks = description.document.content;
    expect("content" in blocks[0]).toBe(false);
    expect(blocks[1].content).toStrictEqual([]);
    const inline = blocks[2].content ?? [];
    expect(inline[0]).toStrictEqual({ type: "text", text: "A", marks: [] });
    expect(inline[1]).toStrictEqual({
      type: "text",
      text: "B",
      marks: [
        { type: "fontSizePreset", attrs: { preset: "normal" } },
        { type: "italic" },
      ],
    });
    expect(inline[2]).toStrictEqual({ type: "hardBreak" });
  });

  it("preserves normalized decimals, nulls and enum literals", () => {
    const model = hydrateDraftModel(populatedEnvelope());
    expect(model.fields.compensation).toStrictEqual({
      mode: "range",
      amount: null,
      min: "30000.00",
      max: "45000.00",
      currency: "MXN",
      pay_period: "monthly",
      basis: "gross",
      public_visible: false,
    });
    expect(model.fields.work_mode).toBe("hybrid");
    expect(model.fields.requester).not.toBeNull();
  });

  it("preserves 100-item lists and the 8-code benefit catalog", () => {
    const skills = Array.from({ length: 100 }, (_, index) => `skill-${index}`);
    const customBenefits = Array.from({ length: 100 }, (_, index) => `benefit-${index}`);
    const screeningQuestions = Array.from({ length: 100 }, (_, index) => ({ prompt: `Q${index}?` }));
    const languages = Array.from({ length: 100 }, (_, index) => ({
      language: "other",
      custom_name: `Lang ${index}`,
      level: null,
    }));
    const benefits = [...BENEFITS].reverse();
    const normalized = draftPostBodySchema.parse({
      fields: { skills, custom_benefits: customBenefits, screening_questions: screeningQuestions, languages, benefits },
    }).fields;

    const model = hydrateDraftModel(
      envelope({ skills, custom_benefits: customBenefits, screening_questions: screeningQuestions, languages, benefits }),
    );
    expect(model.fields.skills).toStrictEqual(normalized.skills);
    expect(model.fields.custom_benefits).toStrictEqual(normalized.custom_benefits);
    expect(model.fields.screening_questions).toStrictEqual(normalized.screening_questions);
    expect(model.fields.languages).toStrictEqual(normalized.languages);
    expect(model.fields.benefits).toStrictEqual(benefits);
    expect(draftModelToPostBody(model).fields.skills).toHaveLength(100);
    expect(draftModelToPostBody(model).fields.benefits).toHaveLength(8);
  });

  it("refuses a malformed read envelope without returning a partial model", () => {
    expect(() => hydrateDraftModel({})).toThrow(ZodError);

    const missingField = populatedEnvelope();
    delete (missingField.fields as unknown as Record<string, unknown>).skills;
    expect(() => hydrateDraftModel(missingField)).toThrow(ZodError);

    const namelessRequester = populatedEnvelope();
    (namelessRequester.fields as unknown as Record<string, unknown>).requester = { kind: "client", id: null };
    expect(() => hydrateDraftModel(namelessRequester)).toThrow(ZodError);

    const mismatchedPlain = populatedEnvelope();
    (mismatchedPlain.fields as unknown as Record<string, unknown>).description = null;
    expect(() => hydrateDraftModel(mismatchedPlain)).toThrow(ZodError);
  });

  it("does not mutate the read envelope", () => {
    const input = populatedEnvelope();
    const snapshot = structuredClone(input);
    hydrateDraftModel(input);
    expect(input).toStrictEqual(snapshot);
  });

  it("detaches the model from the read envelope in both directions", () => {
    const input = populatedEnvelope();
    const snapshot = structuredClone(input);
    const model = hydrateDraftModel(input);

    model.fields.skills.push("model-mutation");
    nonNullDescription(model.fields).document.content.pop();
    model.fields.compensation.currency = "USD";
    expect(input).toStrictEqual(snapshot);

    const modelSnapshot = structuredClone(model);
    input.fields.skills.push("input-mutation");
    nonNullDescription(input.fields).document.content.pop();
    expect(model).toStrictEqual(modelSnapshot);
  });
});

describe("draftModelToPostBody / draftModelToPatchBody", () => {
  it("serializes the complete 17-field snapshot through both accepted body schemas", () => {
    const model = hydrateDraftModel(populatedEnvelope());
    const expected = { fields: model.fields };
    const post = draftModelToPostBody(model);
    const patch = draftModelToPatchBody(model);
    expect(post).toStrictEqual(expected);
    expect(patch).toStrictEqual(expected);
    expect(Object.keys(post.fields)).toHaveLength(18);
    expect(Object.keys(patch.fields)).toHaveLength(18);
    expect(draftPostBodySchema.parse(post).fields).toStrictEqual(model.fields);
    expect(draftPatchBodySchema.parse(patch).fields).toStrictEqual(model.fields);
  });

  it("round-trips default and populated models without loss", () => {
    for (const model of [createDraftModel(), hydrateDraftModel(populatedEnvelope())]) {
      expect(draftModelToPostBody(model)).toStrictEqual({ fields: model.fields });
      expect(draftModelToPatchBody(model)).toStrictEqual({ fields: model.fields });
    }
  });

  it("does not write derived display values into either body", () => {
    const model = hydrateDraftModel(populatedEnvelope());
    for (const body of [draftModelToPostBody(model), draftModelToPatchBody(model)]) {
      expect(body).not.toHaveProperty("requesterName");
      expect(body).not.toHaveProperty("descriptionPlain");
      expect(Object.keys(body.fields)).not.toContain("description_plain");
      expect(body.fields.requester).toStrictEqual({ kind: "client", id: ID });
    }
  });

  it("keeps caller-owned metadata out of the serialized body", () => {
    const model = {
      ...hydrateDraftModel(populatedEnvelope()),
      id: "caller-owned",
      etag: 'jd-r1-123e4567-e89b-42d3-a456-426614174000-v1',
    } as DraftModel;
    expect(draftModelToPostBody(model)).toStrictEqual({ fields: model.fields });
    expect(draftModelToPostBody(model)).not.toHaveProperty("etag");
  });

  it.each(WRITABLE_FIELD_KEYS)("requires %s instead of silently defaulting a partial model", (key) => {
    const deleted = createDraftModel();
    deleteField(deleted, key);
    expect(() => draftModelToPostBody(deleted)).toThrow(/draft model/);
    expect(() => draftModelToPatchBody(deleted)).toThrow(/draft model/);

    const undefinedValue = createDraftModel();
    (undefinedValue.fields as unknown as Record<string, unknown>)[key] = undefined;
    expect(() => draftModelToPostBody(undefinedValue)).toThrow(/draft model/);
    expect(() => draftModelToPatchBody(undefinedValue)).toThrow(/draft model/);
  });

  it("rejects an unknown extra field and a non-object field set", () => {
    const extra = createDraftModel();
    (extra.fields as unknown as Record<string, unknown>).unknown = "extra";
    expect(() => draftModelToPostBody(extra)).toThrow(/draft model/);

    for (const fields of [null, [], "invalid", undefined]) {
      const model = { ...createDraftModel(), fields } as unknown as DraftModel;
      expect(() => draftModelToPostBody(model)).toThrow(/draft model/);
    }
  });

  it("refuses invalid field values without returning a partial body", () => {
    const invalid = createDraftModel();
    invalid.fields.title = "x".repeat(201);
    expect(() => draftModelToPostBody(invalid)).toThrow(ZodError);
    expect(() => draftModelToPatchBody(invalid)).toThrow(ZodError);

    const invalidBenefit = createDraftModel();
    (invalidBenefit.fields as unknown as Record<string, unknown>).benefits = ["unknown"];
    expect(() => draftModelToPostBody(invalidBenefit)).toThrow(ZodError);
  });

  it("does not mutate the model", () => {
    const model = hydrateDraftModel(populatedEnvelope());
    const snapshot = structuredClone(model);
    draftModelToPostBody(model);
    draftModelToPatchBody(model);
    expect(model).toStrictEqual(snapshot);
  });

  it("detaches every serialized body from the model in both directions", () => {
    const shape = () => {
      const model = hydrateDraftModel(populatedEnvelope());
      return { model, post: draftModelToPostBody(model), patch: draftModelToPatchBody(model) };
    };

    // model -> body: mutating the model must not change an already serialized body.
    {
      const { model, post, patch } = shape();
      const postSnapshot = structuredClone(post);
      const patchSnapshot = structuredClone(patch);
      model.fields.skills.push("model-mutation");
      nonNullDescription(model.fields).document.content.pop();
      model.fields.compensation.currency = "USD";
      expect(post).toStrictEqual(postSnapshot);
      expect(patch).toStrictEqual(patchSnapshot);
    }

    // body -> model: mutating a serialized body must not change the model.
    {
      const { model, post, patch } = shape();
      const modelSnapshot = structuredClone(model);
      const postFields: DraftModel["fields"] = post.fields;
      const patchFields = patch.fields as DraftModel["fields"];
      postFields.skills.push("body-mutation");
      nonNullDescription(postFields).document.content.pop();
      postFields.compensation.currency = "USD";
      patchFields.skills.push("body-mutation");
      nonNullDescription(patchFields).document.content.pop();
      patchFields.compensation.currency = "USD";
      expect(model).toStrictEqual(modelSnapshot);
    }
  });
});
