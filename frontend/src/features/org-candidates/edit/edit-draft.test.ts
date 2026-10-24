import { expect, it } from "vitest";
import { candidateEditValues, prepareCandidateEdit, valuesToEditDraft, type CandidateEditDraft } from "./edit-draft";
import { editFixture } from "./test-fixtures";

it.each([
 ["name", { full_name: "" }, "full_name"],
 ["email", { email: "bad" }, "email"],
 ["phone", { phone: "12" }, "phone"],
 ["years", { years_of_experience: "bad" }, "years_of_experience"],
 ["Mexico state", { location: { country: "MX", state: null, municipality: null, postal_code: null } }, "location.state"],
 ["Mexico municipality", { location: { country: "MX", state: "14", municipality: null, postal_code: null } }, "location.municipality"],
] satisfies [string, Partial<CandidateEditDraft>, string][])("validates changed %s", (_label, patch, error) => {
 const candidate = editFixture();
 const draft = { ...valuesToEditDraft(candidateEditValues(candidate)), ...patch };
 expect(prepareCandidateEdit(candidate, draft, []).errors).toHaveProperty(error);
});

it.each([
 ["phone", { dial: "+52", phone: "5512345678" }, { phone: "+525512345678" }],
 ["cleared phone", { phone: "" }, { phone: null }],
 ["location", { location: { country: "US", state: null, municipality: null, postal_code: null } }, { location: { country: "US" } }],
 ["education", { education: [{ level: "bachelor", status: "completed", institution: " UNAM ", field: "", start_year: "2010", end_year: "2014" }] }, { education: [{ level: "bachelor", status: "completed", institution: "UNAM", field: null, start_year: 2010, end_year: 2014 }] }],
 ["languages", { languages: [{ code: "en", level: "C1" }] }, { languages: [{ code: "en", level: "C1" }] }],
 ["skills as typed", { skills: "React, react, TypeScript" }, { skills: ["React", "TypeScript"] }],
 ["cleared collections", { skills: "", languages: [], education: [] }, { skills: null, languages: null }],
] satisfies [string, Partial<CandidateEditDraft>, object][])("converts changed %s and sends only the changed fields", (_label, patch, set) => {
 const candidate = editFixture();
 const result = prepareCandidateEdit(candidate, { ...valuesToEditDraft(candidateEditValues(candidate)), ...patch }, []);
 expect(result.errors).toEqual({});
 expect(result.body).toEqual({ set });
});

it.each(["email", "phone"] as const)("checks effective contact when resetting %s", field => {
 const candidate = editFixture("organic");
 candidate.contact = { email: null, phone: null, ...{ [field]: field === "email" ? "a@example.com" : "+525512345678" } };
 candidate.original!.contact = { email: null, phone: null };
 const draft = valuesToEditDraft(candidateEditValues(candidate));
 expect(prepareCandidateEdit(candidate, draft, [field]).errors.contact).toBe("Agrega un correo o un teléfono.");
 candidate.original!.contact = { email: field === "email" ? "original@example.com" : null, phone: field === "phone" ? "+525512345678" : null };
 expect(prepareCandidateEdit(candidate, draft, [field]).errors).toEqual({});
});

it.each(["email", "phone", "linkedin_url"] as const)("does not revalidate unchanged legacy %s", field => {
 const candidate = editFixture();
 if (field === "linkedin_url") candidate.linkedin_url = "legacy link";
 else candidate.contact[field] = "legacy value";
 const draft = { ...valuesToEditDraft(candidateEditValues(candidate)), professional_title: " Nuevo título " };
 const result = prepareCandidateEdit(candidate, draft, []);
 expect(result.errors).toEqual({});
 expect(result.body).toEqual({ set: { professional_title: "Nuevo título" } });
});
