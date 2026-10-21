import { describe, expect, it } from "vitest";
import { activeLifecycle } from "./lifecycle-fixture";
import { draftV2PatchBodySchema, draftV2PostBodySchema } from "./screening-v2/wire";
import { draftReadEnvelopeV2Schema } from "./read-v2";
import { draftEditSeedFromRead } from "./reopen/seed";
import { initialDraftFormState, composeDraftFields } from "./ui/draft-form-state";

const location = { country: { id: "MX", name: "México" }, state: { id: "01", name: "Aguascalientes" }, municipality: { id: "01001", name: "Aguascalientes" }, postal_code: null, label: "Aguascalientes, Aguascalientes" };
describe("draft geography boundary", () => {
  it("hydrates read references into code-only whole-field writes and retains remote scope onsite", () => {
    const fields = draftV2PostBodySchema.parse({ fields: {} }).fields;
    const read = draftReadEnvelopeV2Schema.parse({ schema_version: 2, lifecycle: activeLifecycle, id: "123e4567-e89b-42d3-a456-426614174000", status: "draft", principal_recruiter_id: "123e4567-e89b-42d3-a456-426614174000", version: "1", created_at: "2026-10-06T03:00:00.123456Z", updated_at: "2026-10-06T03:00:00.123456Z", fields: { ...fields, location, work_mode: "onsite", remote_scope: { kind: "countries", countries: [{ id: "CO", name: "Colombia" }, { id: "MX", name: "México" }] }, description_plain: null } });
    const state = initialDraftFormState(draftEditSeedFromRead(read).model);
    const body = draftV2PatchBodySchema.parse({ fields: composeDraftFields(state) });
    expect(body.fields.location).toEqual({ country: "MX", state: "01", municipality: "01001" });
    expect(body.fields.remote_scope).toEqual({ kind: "countries", countries: ["CO", "MX"] });
  });
  it("defaults and clears geography, rejects legacy text and never adds omitted patch fields", () => {
    expect(draftV2PostBodySchema.parse({ fields: {} }).fields.remote_scope).toBeNull();
    expect(draftV2PatchBodySchema.parse({ fields: { location: null } })).toEqual({ fields: { location: null } });
    expect(draftV2PatchBodySchema.safeParse({ fields: { location: "México" } }).success).toBe(false);
  });
});
