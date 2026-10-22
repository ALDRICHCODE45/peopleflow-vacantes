import { describe, expect, it } from "vitest";
import { draftPostBodySchema } from "./fields";
import { createDraftModel, draftModelToPatchBody } from "./model";
import { initialDraftFormState, validateDraftFormState } from "./ui/draft-form-state";
import { publicJobDetailSchema, publicJobItemSchema } from "../schemas";
import { vacancyDetail, legacyDetail, listItem } from "../api/public-fixtures";

import { filledDraftRead, storedWriteFields } from "./reopen/test-fixture";
import { draftEditSeedFromRead } from "./reopen/seed";
import { draftV2SnapshotToPatchBody } from "./screening-v2/wire";
import { validateLocalDraftV2FormState, toDraftScreeningV2State } from "./ui/draft-screening-v2-state";
import { editorReadiness } from "./pipeline/publication-model";

const requirements = { languages: [{ code: "en", min_level: "B2" }], min_years_of_experience: "1.5", min_education_level: "bachelor", accepts_in_progress_education: true };
describe("H3 requirements", () => {
  it("reopens migrated v2 fields and serializes them unchanged without a client-side legacy migration", () => {
    const read = filledDraftRead(); read.fields.seniority = "semi_senior";
    read.fields.languages = [{ code: "en", min_level: "C1" }, { code: "es", min_level: "native" }, { code: "pt", min_level: "A2" }];
    const seed = draftEditSeedFromRead(read);
    const result = validateLocalDraftV2FormState(initialDraftFormState(seed.model), seed.model, toDraftScreeningV2State(seed.screeningQuestionsV2));
    expect(result.ok).toBe(true);
    if (result.ok) expect(draftV2SnapshotToPatchBody(result.model).fields).toEqual(storedWriteFields(read));
  });
  it("does not count any profile requirement toward publication completeness", () => {
    const state = initialDraftFormState(createDraftModel());
    const empty = editorReadiness(state, []);
    Object.assign(state, { seniority: "director", min_years_of_experience: "60", min_education_level: "phd", accepts_in_progress_education: true, languages: [{ id: "one", code: "en", min_level: "C2" }] });
    expect(editorReadiness(state, [])).toEqual(empty);
  });
  it.each(["intern", "junior", "semi_senior", "senior", "lead", "manager", "director"])("round trips %s and minimum requirements", seniority => {
    const model = { ...createDraftModel(), fields: draftPostBodySchema.parse({ fields: { ...requirements, seniority } }).fields };
    const result = validateDraftFormState(initialDraftFormState(model), model);
    expect(result.ok).toBe(true);
    if (result.ok) expect(draftModelToPatchBody(result.model).fields).toMatchObject({ ...requirements, seniority });
  });
  it.each(["0", "0.0", "1.5", "60", "60.0"])("accepts decimal string %s", min_years_of_experience => {
    expect(draftPostBodySchema.safeParse({ fields: { min_years_of_experience } }).success).toBe(true);
  });
  it.each(["01", "1.50", "60.5", "61", "-1", " 1", "1\n", 1.5])("rejects noncontract years %j", min_years_of_experience => {
    expect(draftPostBodySchema.safeParse({ fields: { min_years_of_experience } }).success).toBe(false);
  });
  it("defaults optional requirements and rejects old unmigrated wire shapes", () => {
    expect(createDraftModel().fields).toMatchObject({ languages: [], min_years_of_experience: null, min_education_level: null, accepts_in_progress_education: false });
    expect(draftPostBodySchema.safeParse({ fields: { seniority: "mid" } }).success).toBe(false);
    expect(draftPostBodySchema.safeParse({ fields: { languages: [{ language: "en", custom_name: null, level: "advanced" }] } }).success).toBe(false);
  });
  it("bounds languages at twenty, rejects duplicates and missing/old levels", () => {
    const languages = Array.from({ length: 20 }, (_, i) => ({ code: `opaque${i}`, min_level: "native" }));
    expect(draftPostBodySchema.safeParse({ fields: { languages } }).success).toBe(true);
    for (const invalid of [[...languages, { code: "extra", min_level: "A1" }], [languages[0], languages[0]], [{ code: "en", min_level: null }], [{ code: "en", min_level: "basic" }]]) {
      expect(draftPostBodySchema.safeParse({ fields: { languages: invalid } }).success).toBe(false);
    }
  });
  it.each([vacancyDetail, legacyDetail])("requires the public profile on details and list items", fixture => {
    const detail = { ...fixture, seniority: "semi_senior", requirements_profile: requirements };
    expect(publicJobDetailSchema.safeParse(detail).success).toBe(true);
    expect(publicJobItemSchema.safeParse({ ...listItem(fixture), seniority: "semi_senior", requirements_profile: requirements }).success).toBe(true);
    const missing = { ...detail } as Record<string, unknown>;
    delete missing.requirements_profile;
    expect(publicJobDetailSchema.safeParse(missing).success).toBe(false);
  });
});
