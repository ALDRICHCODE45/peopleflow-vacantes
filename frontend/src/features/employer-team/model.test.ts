import { expect, it } from "vitest";

import { COMPANY_MEMBER_ROLE_LABELS, COMPANY_MEMBER_ROLES, TEAM_MEMBER_ROLE_LABELS, TEAM_MEMBER_ROLES } from "./model";

it("labels both backend member roles in Spanish", () => {
  expect(TEAM_MEMBER_ROLES).toEqual(["owner", "recruiter"]);
  expect(TEAM_MEMBER_ROLE_LABELS).toEqual({ owner: "Dueño", recruiter: "Reclutador" });
  expect(Object.isFrozen(TEAM_MEMBER_ROLE_LABELS)).toBe(true);
});

it("labels the stakeholder membership for display only; it is never a writable role (D5)", () => {
  expect(COMPANY_MEMBER_ROLES).toEqual(["owner", "recruiter", "stakeholder"]);
  expect(COMPANY_MEMBER_ROLE_LABELS).toEqual({ owner: "Dueño", recruiter: "Reclutador", stakeholder: "Stakeholder" });
  expect(Object.isFrozen(COMPANY_MEMBER_ROLE_LABELS)).toBe(true);
  expect(TEAM_MEMBER_ROLES).not.toContain("stakeholder");
});
