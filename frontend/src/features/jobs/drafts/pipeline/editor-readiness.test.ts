import { expect, it } from "vitest";
import { editorReadiness } from "./publication-model";
import { initialDraftFormState } from "../ui/draft-form-state";
import { createDraftModel } from "../model";
it("uses one slot for alternative geography and date failures, excluding unknown server state", () => {
 const state = initialDraftFormState(createDraftModel());
 const empty = editorReadiness(state, null);
 expect(empty.total).toBe(8); expect(empty.pending).toBe(8); expect(empty.percent).toBe(0);
 expect(empty.sectionComplete).toEqual([false, false, null, null, false]);
 state.work_mode = "remote"; state.remote_scope = { kind: "anywhere" };
 expect(editorReadiness(state, null).pending).toBe(6);
 const known = editorReadiness(state, ["commitment_date_past", "delivery_target_missing"]);
 expect(known.total).toBe(13); expect(known.pending).toBe(8);
 expect(known.serverKnown).toBe(true);
});
it("local editor values supersede stale server editor missing codes", () => {
 const state = initialDraftFormState(createDraftModel()); state.title = "Backend";
 expect(editorReadiness(state, ["title_missing"]).missing).not.toContain("title_missing");
 state.work_mode = "hybrid"; state.location = { country: "MX", state: "09", municipality: null, postal_code: null };
 expect(editorReadiness(state, null).missing).toContain("location_incomplete");
 state.location.municipality = "001";
 expect(editorReadiness(state, null).missing).not.toContain("location_incomplete");
});
