import { expect, it } from "vitest";
import { phoneValue, serverErrors } from "./draft";
import { contactSchema } from "./model";

it("maps required residence errors to specific instructions", () => {
 expect(serverErrors([
  { field: "candidate.residence.country", code: "required" },
  { field: "candidate.residence.state", code: "required" },
  { field: "candidate.residence.municipality", code: "required" },
 ])).toEqual({ "residence.country": "Elige un país.", "residence.state": "Elige un estado.", "residence.municipality": "Elige un municipio." });
});
it.each([
 ["+1", "123456", null],
 ["+1", "1234567", "+11234567"],
 ["+123", "12345", "+12312345"],
 ["+1", "12345678901234", "+112345678901234"],
 ["+12", "12345678901234", null],
 ["+52", "5512345678", "+525512345678"],
 ["+52", "551234567", null],
 ["+52", "55123456789", null],
])("validates combined E.164 %s/%s", (dial, number, expected) => {
 expect(phoneValue(dial, number)).toBe(expected);
});
it.each([
 ["+1123456", false], ["+11234567", true], ["+112345678901234", true],
 ["+1123456789012345", false], ["+01234567", false],
 ["+525512345678", true], ["+52551234567", false], ["+5255123456789", false],
])("validates the contact contract %s", (phone, valid) => {
 expect(contactSchema.safeParse({ email: null, phone }).success).toBe(valid);
});
