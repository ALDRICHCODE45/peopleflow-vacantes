import { expect, it } from "vitest";
import { errorSchema } from "./model";
import { applicationFailure } from "./failure";

it.each(["applicant_country_required", "applicant_country_not_allowed"])("decodes %s with ordered ISO countries", code => {
  const envelope = errorSchema.parse({ error: "country gate", code, data: { allowed: ["CO", "MX"] } });
  expect(applicationFailure({ ok: false, error: { kind: "http", status: 422 }, envelope })).toEqual({ ok: false, reason: code, allowed: ["CO", "MX"], reference: { status: 422, code } });
});
it.each([undefined, { allowed: ["Mexico"] }, { allowed: [] }, { allowed: ["MX", "MX"] }])("rejects malformed gate data %j", data => {
  expect(errorSchema.safeParse({ error: "country gate", code: "applicant_country_required", ...(data ? { data } : {}) }).success).toBe(false);
});
