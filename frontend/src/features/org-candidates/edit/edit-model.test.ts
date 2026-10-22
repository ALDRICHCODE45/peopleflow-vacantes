import { expect, it } from "vitest";
import { buildCandidateEditBody, candidateEditBodySchema, candidateEditDetailFieldsSchema, candidateEditErrors, classifyCandidateEditFailure } from "./edit-model";
import { editFixture, valuesFixture } from "./test-fixtures";

it("accepts the additive detail contract and rejects a missing or invalid etag", () => {
 expect(candidateEditDetailFieldsSchema.safeParse(editFixture()).success).toBe(true);
 expect(candidateEditDetailFieldsSchema.safeParse({ ...editFixture(), etag: "bad" }).success).toBe(false);
});
it("sends only changed fields, replacing arrays rather than merging", () => {
 const before = valuesFixture();
 expect(buildCandidateEditBody("manual", before, { ...before, skills: ["Go"], languages: [] })).toStrictEqual({ set: { skills: ["Go"], languages: null } });
 expect(buildCandidateEditBody("manual", before, { ...before })).toStrictEqual({ set: {} });
});
it("normalizes cleared strings and arrays to null without erasing untouched fields", () => {
 const before = { ...valuesFixture(), education: [{ level: "bachelor" as const, status: "completed" as const, institution: null, field: null, start_year: null, end_year: null }] };
 expect(buildCandidateEditBody("manual", before, { ...before, professional_title: "  ", education: [] })).toStrictEqual({ set: { professional_title: null, education: null } });
});
it("allows organic reset only and never sends the same field in set", () => {
 const before = valuesFixture(); const after = { ...before, seniority: "junior" as const };
 expect(buildCandidateEditBody("organic", before, after, ["seniority", "seniority"])).toEqual({ set: {}, reset: ["seniority"] });
 expect(buildCandidateEditBody("manual", before, after, ["seniority"])).toStrictEqual({ set: { seniority: "junior" } });
 // The backend rejects any `reset` key on manual records, and an empty list carries nothing (QA L12).
 expect(buildCandidateEditBody("organic", before, after)).toStrictEqual({ set: { seniority: "junior" } });
});
it("rejects overlapping set/reset and unknown write fields at the action boundary", () => {
 expect(candidateEditBodySchema.safeParse({ set: { phone: null }, reset: ["phone"] }).success).toBe(false);
 expect(candidateEditBodySchema.safeParse({ set: { summary: "Not editable" }, reset: [] }).success).toBe(false);
});
it("validates six-key education reads and organic original education must remain null", () => {
 const candidate = editFixture("organic");
 expect(candidateEditDetailFieldsSchema.safeParse(candidate).success).toBe(true);
 expect(candidateEditDetailFieldsSchema.safeParse({ ...candidate, education: [{ level: "bachelor" }] }).success).toBe(false);
 expect(candidateEditDetailFieldsSchema.safeParse({ ...candidate, original: { ...candidate.original, education: [] } }).success).toBe(false);
});
it("maps unprefixed indexed paths and contact errors to editor fields", () => {
 expect(candidateEditErrors([{ field: "education[0].status", code: "required" }, { field: "phone", code: "invalid" }, { field: "contact", code: "required" }, { field: "skills[1]", code: "too_long" }])).toEqual({ "education.0.status": "Completa este dato.", phone: "Revisa este dato.", contact: "Agrega un correo o un teléfono.", skills: "Este dato es demasiado largo." });
});
it.each([[412, "precondition_failed"], [428, "precondition_required"], [404, "not_found"], [401, "unauthenticated"], [403, "forbidden"], [400, "validation_error"]] as const)("classifies %s", (status, code) => {
 expect(classifyCandidateEditFailure(status, code, "status")).toBe(code);
});
