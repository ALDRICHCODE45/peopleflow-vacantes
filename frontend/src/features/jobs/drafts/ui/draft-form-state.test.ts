import { mexicoLocationWrite, mexicoLocationValue } from "../geography-fixture";
import { describe, expect, it } from "vitest";

import { draftPostBodySchema } from "../fields";
import type { DraftModel } from "../model";
import { BENEFITS } from "../lists";
import { CEFR_LEVELS } from "@/features/candidate/model";
import {
  addLanguageRow,
  addListRow,
  changeRequesterKind,
  selectRequester,
  composeDraftFields,
  initialDraftFormState,
  removeLanguageRow,
  removeListRow,
  toggleBenefit,
  updateCompensation,
  updateLanguageRow,
  updateListRow,
  validateDraftFormState,
} from "./draft-form-state";
import {
  COMPENSATION_AMOUNT_ERROR,
  COMPENSATION_RANGE_ERROR,
  DESCRIPTION_ERROR,
  LIST_ITEM_DUPLICATE_ERROR,
  LIST_ITEM_EMPTY_ERROR,
  REQUESTER_ERROR,
  TITLE_ERROR,
  WORK_MODE_ERROR,
} from "./draft-messages";

const ID = "123e4567-e89b-42d3-a456-426614174000";

it("selects and clears a catalog entry, composing only kind/id and updating preview name", () => {
 const model = populatedModel(); const state = initialDraftFormState(model);
 const selected = selectRequester(state, {kind:"client",id:ID,name:"Nuevo cliente"});
 expect(composeDraftFields(selected).requester).toEqual({kind:"client",id:ID});
 expect(selected.requester.original).toEqual(state.requester.original);
 expect(validateDraftFormState(selected,model)).toMatchObject({ok:true,model:{requesterName:"Nuevo cliente"}});
 const cleared = selectRequester(selected,null);
 expect(composeDraftFields(cleared).requester).toEqual({kind:"client",id:null});
 expect(cleared.requester.name).toBeNull();
});

/** A complete, already-normalized 17-field model with every field populated. */
function populatedModel(): DraftModel {
  const body = draftPostBodySchema.parse({
    fields: {
      title: "Backend Go",
      location: mexicoLocationWrite,
      work_mode: "hybrid",
      work_schedule: "full_time",
      contract_type: "indefinite",
      seniority: "senior",
      professional_area: "technology_systems",
      required_requirements: "Go y PostgreSQL",
      preferred_requirements: "Kubernetes",
      skills: ["Go", "PostgreSQL"],
      custom_benefits: ["Café gratis"],
      benefits: ["annual_bonus", "health_insurance"],
      screening_questions: [{ prompt: "¿Cuántos años de experiencia tienes?" }],
      requester: { kind: "client", id: ID },
      languages: [{ code: "fr", min_level: "A2" }],
      compensation: {
        mode: "range",
        amount: null,
        min: "30000",
        max: "45000",
        currency: "MXN",
        pay_period: "monthly",
        basis: "gross",
        public_visible: false,
      },
      description: {
        schema_version: 1,
        document: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }],
        },
      },
    },
  });
  return {
    fields: body.fields,
    requesterName: "Cliente Ejemplo",
    descriptionPlain: "Hola",
  };
}

describe("initialDraftFormState", () => {
  it("seeds every raw field from the accepted model exactly", () => {
    const model = populatedModel();
    const state = initialDraftFormState(model);

    expect(state.title).toBe("Backend Go");
    expect(state.location).toEqual(mexicoLocationValue);
    expect(state.work_mode).toBe("hybrid");
    expect(state.work_schedule).toBe("full_time");
    expect(state.contract_type).toBe("indefinite");
    expect(state.seniority).toBe("senior");
    expect(state.professional_area).toBe("technology_systems");
    expect(state.required_requirements).toBe("Go y PostgreSQL");
    expect(state.preferred_requirements).toBe("Kubernetes");
    expect(state.skills.map((row: { value: string }) => row.value)).toEqual([
      "Go",
      "PostgreSQL",
    ]);
    expect(state.custom_benefits.map((row: { value: string }) => row.value)).toEqual([
      "Café gratis",
    ]);
    expect(state.benefits).toEqual(["annual_bonus", "health_insurance"]);
    expect(state.screening_questions.map((row: { value: string }) => row.value)).toEqual([
      "¿Cuántos años de experiencia tienes?",
    ]);
    expect(state.requester.original).toEqual({ kind: "client", id: ID });
    expect(state.requester.kind).toBe("client");
    expect(state.requester.id).toBe(ID);
    expect(state.requester.name).toBe("Cliente Ejemplo");
    expect(state.requester.changed).toBe(false);
    expect(state.languages).toHaveLength(1);
    expect(state.languages[0].code).toBe("fr");
    expect(state.languages[0].min_level).toBe("A2");
    expect(state.compensation).toEqual({
      mode: "range",
      amount: "",
      min: "30000.00",
      max: "45000.00",
      currency: "MXN",
      pay_period: "monthly",
      basis: "gross",
      public_visible: false,
    });
    // The accepted rich JSON is referenced, never cloned or rewritten on mount.
    expect(state.description).toBe(model.fields.description);
  });

  it("shows the contract visual requester type without a fake id for an empty draft", () => {
    const model = populatedModel();
    model.fields.requester = null;
    model.requesterName = null;

    const state = initialDraftFormState(model);

    expect(state.requester.original).toBeNull();
    expect(state.requester.kind).toBe("internal_area");
    expect(state.requester.id).toBeNull();
    expect(state.requester.name).toBeNull();
    expect(state.requester.changed).toBe(false);
  });
});

describe("composeDraftFields", () => {
  it("keeps raw text and maps unselected enums to null", () => {
    const state = initialDraftFormState(populatedModel());
    state.title = "  Backend  ";
    state.work_mode = "";
    state.work_schedule = "";

    const fields = composeDraftFields(state);

    expect(fields.title).toBe("  Backend  ");
    expect(fields.work_mode).toBeNull();
    expect(fields.work_schedule).toBeNull();
    expect(fields.skills).toEqual(["Go", "PostgreSQL"]);
    expect(fields.screening_questions).toEqual([
      { prompt: "¿Cuántos años de experiencia tienes?" },
    ]);
  });

  it("composes only the active compensation fields and keeps inactive buffers", () => {
    let state = initialDraftFormState(populatedModel());
    state.compensation = {
      mode: "fixed",
      amount: "12000.50",
      min: "10.00",
      max: "20.00",
      currency: "USD",
      pay_period: "yearly",
      basis: "net",
      public_visible: true,
    };

    const fixed = composeDraftFields(state).compensation as Record<string, unknown>;
    expect(fixed).toEqual({
      mode: "fixed",
      amount: "12000.50",
      min: null,
      max: null,
      currency: "USD",
      pay_period: "yearly",
      basis: "net",
      public_visible: true,
    });

    state = updateCompensation(state, { mode: "range" });
    const range = composeDraftFields(state).compensation as Record<string, unknown>;
    expect(range.amount).toBeNull();
    expect(range.min).toBe("10.00");
    expect(range.max).toBe("20.00");

    // Switching back restores the buffered amount: nothing was erased.
    state = updateCompensation(state, { mode: "fixed" });
    expect((composeDraftFields(state).compensation as Record<string, unknown>).amount).toBe(
      "12000.50",
    );

    state = updateCompensation(state, { mode: "" });
    const none = composeDraftFields(state).compensation as Record<string, unknown>;
    expect(none.amount).toBeNull();
    expect(none.min).toBeNull();
    expect(none.max).toBeNull();
  });

  it("sends only code and minimum level for every language", () => {
    const state = initialDraftFormState(populatedModel());
    state.languages = [
      { id: "language-1", code: "fr", min_level: "A2" },
      { id: "language-2", code: "es", min_level: "native" },
    ];

    const languages = composeDraftFields(state).languages as Record<string, unknown>[];

    expect(languages).toEqual([
      { code: "fr", min_level: "A2" },
      { code: "es", min_level: "native" },
    ]);
  });

  it("preserves the supplied requester until the type is explicitly changed", () => {
    const state = initialDraftFormState(populatedModel());
    expect(composeDraftFields(state).requester).toEqual({ kind: "client", id: ID });

    const changed = changeRequesterKind(state, "internal_area");
    expect(composeDraftFields(changed).requester).toEqual({
      kind: "internal_area",
      id: null,
    });
  });
});

describe("validateDraftFormState", () => {
  it("returns the lossless complete model for an untouched populated draft", () => {
    const model = populatedModel();
    const state = initialDraftFormState(model);

    const result = validateDraftFormState(state, model);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.fields).toEqual(model.fields);
    expect(result.model.requesterName).toBe("Cliente Ejemplo");
    expect(result.model.descriptionPlain).toBe("Hola");
    // Serialized content is lossless and the raw editor value keeps its identity.
    expect(result.model.fields.description).toEqual(model.fields.description);
    expect(state.description).toBe(model.fields.description);
    expect(model.fields.title).toBe("Backend Go");
  });

  it("reports the exact title limit without truncating the raw state", () => {
    const model = populatedModel();
    const state = initialDraftFormState(model);
    state.title = "a".repeat(201);

    const result = validateDraftFormState(state, model);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.title).toBe(TITLE_ERROR);
    expect(state.title).toBe("a".repeat(201));
  });

  it("reports every invalid control in one atomic pass", () => {
    const model = populatedModel();
    const state = initialDraftFormState(model);
    state.title = "a".repeat(201);
    state.location = { ...mexicoLocationValue, country: "invalid" };
    state.work_mode = "presencial";

    const result = validateDraftFormState(state, model);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.title).toBe(TITLE_ERROR);
    expect(result.errors["location.country"]).toBe("Elige una opción de la lista.");
    expect(result.errors.work_mode).toBe(WORK_MODE_ERROR);
  });

  it("reports a precise row error for an empty or duplicated list item", () => {
    const model = populatedModel();
    const state = initialDraftFormState(model);
    state.skills = [
      { id: "skill-1", value: "Go" },
      { id: "skill-2", value: "   " },
    ];

    const empty = validateDraftFormState(state, model);
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.errors["skills.1"]).toBe(LIST_ITEM_EMPTY_ERROR);

    state.skills = [
      { id: "skill-1", value: "Go" },
      { id: "skill-2", value: " Go " },
    ];
    const duplicate = validateDraftFormState(state, model);
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.errors["skills.1"]).toBe(LIST_ITEM_DUPLICATE_ERROR);
  });

  it("reports compensation money and range errors at their own keys", () => {
    const model = populatedModel();
    const state = initialDraftFormState(model);
    state.compensation = {
      ...state.compensation,
      mode: "range",
      min: "45000",
      max: "30000",
    };

    const reversed = validateDraftFormState(state, model);
    expect(reversed.ok).toBe(false);
    if (reversed.ok) return;
    expect(reversed.errors["compensation.max"]).toBe(COMPENSATION_RANGE_ERROR);

    state.compensation = { ...state.compensation, min: "12,5", max: "" };
    const malformed = validateDraftFormState(state, model);
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.errors["compensation.min"]).toBe(COMPENSATION_AMOUNT_ERROR);
  });

  it("reports a requester problem at the requester key", () => {
    const model = populatedModel();
    const state = initialDraftFormState(model);
    state.requester = { ...state.requester, changed: true, id: "no-es-un-uuid" };

    const result = validateDraftFormState(state, model);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.requester).toBe(REQUESTER_ERROR);
  });

  it("reports an invalid rich description at the description key", () => {
    const model = populatedModel();
    const state = initialDraftFormState(model);
    state.description = {
      schema_version: 1,
      document: { type: "doc", content: [] },
    } as never;

    const result = validateDraftFormState(state, model);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.description).toBe(DESCRIPTION_ERROR);
  });
});

describe("requester type changes", () => {
  it("clears a mismatched supplied requester and explains it visibly", () => {
    const state = initialDraftFormState(populatedModel());

    const next = changeRequesterKind(state, "internal_area");

    expect(next.requester.kind).toBe("internal_area");
    expect(next.requester.id).toBeNull();
    expect(next.requester.name).toBeNull();
    expect(next.requester.changed).toBe(true);
    expect(next.requester.notice).toContain("Cliente Ejemplo");
    expect(next.requester.original).toEqual({ kind: "client", id: ID });
  });

  it("does not treat the visual default as an explicit change", () => {
    const model = populatedModel();
    model.fields.requester = null;
    model.requesterName = null;
    const state = initialDraftFormState(model);

    const next = changeRequesterKind(state, "internal_area");

    expect(next).toBe(state);
    expect(composeDraftFields(next).requester).toBeNull();
  });

  it("records an explicit client selection for an empty draft", () => {
    const model = populatedModel();
    model.fields.requester = null;
    model.requesterName = null;
    const state = initialDraftFormState(model);

    const next = changeRequesterKind(state, "client");

    expect(next.requester.changed).toBe(true);
    expect(next.requester.notice).not.toBeNull();
    expect(composeDraftFields(next).requester).toEqual({ kind: "client", id: null });
  });
});

describe("row and catalog helpers", () => {
  it("adds, updates and removes list rows without touching siblings", () => {
    let rows = addListRow([], "skill");
    rows = addListRow(rows, "skill");
    expect(rows.map((row: { id: string }) => row.id)).toEqual(["skill-1", "skill-2"]);

    rows = updateListRow(rows, "skill-1", "  Go  ");
    expect(rows[0].value).toBe("  Go  ");
    expect(rows[1].value).toBe("");

    rows = removeListRow(rows, "skill-1");
    expect(rows.map((row: { id: string }) => row.id)).toEqual(["skill-2"]);
  });

  it("keeps the benefits catalog ordered by selection and toggles membership", () => {
    let benefits = toggleBenefit([], "health_insurance");
    benefits = toggleBenefit(benefits, "annual_bonus");
    expect(benefits).toEqual(["health_insurance", "annual_bonus"]);
    expect(toggleBenefit(benefits, "health_insurance")).toEqual(["annual_bonus"]);
    expect(new Set(benefits).size).toBe(benefits.length);
    for (const code of benefits) expect(BENEFITS).toContain(code);
  });

  it("adds, updates and removes language rows preserving buffers", () => {
    let rows = addLanguageRow([]);
    expect(rows).toHaveLength(1);
    const [row] = rows;

    rows = updateLanguageRow(rows, row.id, { code: "de", min_level: "B2" });
    expect(rows[0]).toMatchObject({ code: "de", min_level: "B2" });

    rows = updateLanguageRow(rows, row.id, { code: "en" });
    expect(rows[0].min_level).toBe("B2");

    rows = removeLanguageRow(rows, row.id);
    expect(rows).toHaveLength(0);
  });

  it("publishes exactly the contract language levels and no CEFR mapping", () => {
    expect([...CEFR_LEVELS]).toEqual(["A1", "A2", "B1", "B2", "C1", "C2", "native"]);
  });
});
