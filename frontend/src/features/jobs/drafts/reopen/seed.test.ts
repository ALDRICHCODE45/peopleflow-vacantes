import { describe, expect, it } from "vitest";

import { draftReadEnvelopeV2Schema, type DraftReadEnvelopeV2 } from "../read-v2";
import { draftV2SnapshotToPatchBody } from "../screening-v2/wire";
import { initialDraftFormState } from "../ui/draft-form-state";
import {
  toDraftScreeningV2State,
  validateLocalDraftV2FormState,
} from "../ui/draft-screening-v2-state";
import { draftEditSeedFromRead } from "./seed";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUESTER_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const at = "2026-10-06T03:00:00.123456Z";
const CORRECT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const description = {
  schema_version: 1,
  document: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Buscamos a alguien ", marks: [{ type: "bold" }] }, { type: "text", text: "con ganas." }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Go" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "PostgreSQL" }] }] },
        ],
      },
    ],
  },
};

const questions = [
  { id: "d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d", type: "open", prompt: "Cuéntanos de un proyecto." },
  {
    id: "b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    type: "single_choice_evaluated",
    prompt: "¿Qué declara una función en Go?",
    options: [
      { id: CORRECT_ID, label: "func" },
      { id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", label: "function" },
    ],
    correct_option_id: CORRECT_ID,
  },
  {
    id: "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c",
    type: "single_choice_informative",
    prompt: "¿Qué modalidad prefieres?",
    options: [
      { id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", label: "Remoto" },
      { id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70", label: "Híbrido" },
    ],
  },
];

const fullFields = {
  title: "Desarrollador backend",
  location: "Ciudad de México",
  work_mode: "hybrid",
  work_schedule: "full_time",
  contract_type: "indefinite",
  seniority: "senior",
  professional_area: "technology_systems",
  required_requirements: "Cinco años con Go.",
  preferred_requirements: "Experiencia con AWS.",
  skills: ["Go", "SQL"],
  custom_benefits: ["Bono de transporte"],
  benefits: ["health_insurance", "flexible_schedule"],
  screening_questions: questions,
  requester: { kind: "client", id: REQUESTER_ID, name: "Acme S.A." },
  languages: [
    { language: "es", custom_name: null, level: "native" },
    { language: "other", custom_name: "Portugués", level: "basic" },
  ],
  compensation: {
    mode: "range",
    amount: null,
    min: "30000.00",
    max: "45000.50",
    currency: "MXN",
    pay_period: "monthly",
    basis: "gross",
    public_visible: true,
  },
  description,
  description_plain: "Buscamos a alguien con ganas.\nGo\nPostgreSQL",
};

const emptyFields = {
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
    currency: null,
    pay_period: null,
    basis: null,
    public_visible: false,
  },
  description: null,
  description_plain: null,
};

function envelope(fields: Record<string, unknown>): DraftReadEnvelopeV2 {
  return draftReadEnvelopeV2Schema.parse({
    schema_version: 2,
    id: ID,
    status: "draft",
    principal_recruiter_id: ID,
    version: "7",
    created_at: at,
    updated_at: at,
    fields,
  });
}

/** The write fields a full PATCH must send back: the read fields minus derived ones. */
function storedWriteFields(read: DraftReadEnvelopeV2) {
  const fields: Record<string, unknown> = { ...read.fields };
  delete fields.description_plain;
  const requester = read.fields.requester;
  return { ...fields, requester: requester === null ? null : { kind: requester.kind, id: requester.id } };
}

/** The same path the editor takes on "Guardar": form state → validation → PATCH body. */
function saveWithoutEdits(read: DraftReadEnvelopeV2) {
  const seed = draftEditSeedFromRead(read);
  const state = initialDraftFormState(seed.model);
  const result = validateLocalDraftV2FormState(
    state,
    seed.model,
    toDraftScreeningV2State(seed.screeningQuestionsV2),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return { seed, state, body: draftV2SnapshotToPatchBody(result.model) };
}

const cases = {
  "every field filled": fullFields,
  "requester kind without catalog entry": {
    ...fullFields,
    requester: { kind: "internal_area", id: null, name: null },
  },
  "fixed compensation, no questions": {
    ...fullFields,
    screening_questions: [],
    compensation: { ...fullFields.compensation, mode: "fixed", amount: "25000.00", min: null, max: null, public_visible: false },
  },
  "mostly empty draft": emptyFields,
};

describe("draftEditSeedFromRead", () => {
  it.each(Object.entries(cases))("saving %s without edits sends back the stored fields", (_name, fields) => {
    const read = envelope(fields);
    const { body } = saveWithoutEdits(read);
    expect(body.fields).toEqual(storedWriteFields(read));
  });

  it("keeps derived read-only values beside the fields and never inside them", () => {
    const seed = draftEditSeedFromRead(envelope(fullFields));
    expect(seed.model.requesterName).toBe("Acme S.A.");
    expect(seed.model.descriptionPlain).toBe(fullFields.description_plain);
    expect(seed.model.fields.requester).toEqual({ kind: "client", id: REQUESTER_ID });
    expect(seed.model.fields).not.toHaveProperty("description_plain");
    expect(seed.model.fields.screening_questions).toEqual([]);
    expect(seed.screeningQuestionsV2).toEqual(questions);
  });

  it("changes only the edited field", () => {
    const read = envelope(fullFields);
    const { seed, state } = saveWithoutEdits(read);
    const result = validateLocalDraftV2FormState(
      { ...state, title: "Desarrolladora backend" },
      seed.model,
      toDraftScreeningV2State(seed.screeningQuestionsV2),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(draftV2SnapshotToPatchBody(result.model).fields).toEqual({
      ...storedWriteFields(read),
      title: "Desarrolladora backend",
    });
  });

  it("shares no mutable structure with the read envelope", () => {
    const read = envelope(fullFields);
    const before = structuredClone(read);
    const seed = draftEditSeedFromRead(read);
    seed.model.fields.skills.push("Rust");
    seed.screeningQuestionsV2.pop();
    expect(read).toEqual(before);
  });
});
