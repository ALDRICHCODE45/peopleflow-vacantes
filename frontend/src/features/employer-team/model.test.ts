import { expect, it } from "vitest";

import { TEAM_MEMBER_ROLE_LABELS, TEAM_MEMBER_ROLES } from "./model";

it("labels both backend member roles in Spanish", () => {
  expect(TEAM_MEMBER_ROLES).toEqual(["owner", "recruiter"]);
  expect(TEAM_MEMBER_ROLE_LABELS).toEqual({ owner: "Dueño", recruiter: "Reclutador" });
  expect(Object.isFrozen(TEAM_MEMBER_ROLE_LABELS)).toBe(true);
});
