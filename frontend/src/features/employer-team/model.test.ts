import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  TEAM_MEMBER_ROLE_LABELS,
  TEAM_MEMBER_ROLES,
  TEAM_MEMBER_STATUS_LABELS,
  TEAM_MEMBER_STATUSES,
  parseTeamMembers,
  summarizeTeam,
  teamMemberSchema,
  teamMembersSchema,
} from "./model";
import type { TeamMemberRole, TeamMemberStatus } from "./model";
import { NEXO_TEAM_MEMBERS } from "./prototype-team";
import { NEXO_VACANCIES } from "../employer-vacancies/prototype-vacancies";
import { summarizeEmployerVacancies, vacancyInProcessCount } from "../employer-vacancies/model";

const dir = join(process.cwd(), "src", "features", "employer-team");
const modelSource = readFileSync(join(dir, "model.ts"), "utf8");
const fixtureSource = readFileSync(join(dir, "prototype-team.ts"), "utf8");
const DICTIONARIES = [TEAM_MEMBER_ROLE_LABELS, TEAM_MEMBER_STATUS_LABELS];
/** One minimal input the schema must accept, used to build the near-miss cases. */
const VALID_INPUT = { id: "tomas-rios", fullName: "Tomás Ríos", email: "tomas.rios@nexolabs.mx", role: "owner", status: "active", workload: { ownedVacancies: 0, inProcessCandidates: 0 } };
/** Every object reachable from the fixtures, so the freeze check stays deep. */
function reachableObjects(value: unknown): readonly object[] {
  if (typeof value !== "object" || value === null) return [];
  return [value, ...Object.values(value).flatMap(reachableObjects)];
}
/** Vacancies whose recruiter column names this member; test-only portfolio cross-check. */
function vacanciesOf(fullName: string): readonly (typeof NEXO_VACANCIES)[number][] {
  return NEXO_VACANCIES.filter((vacancy) => vacancy.recruiter === fullName);
}
function ownedVacanciesOf(fullName: string): number {
  return vacanciesOf(fullName).length;
}
function inProcessOf(fullName: string): number {
  return vacanciesOf(fullName).reduce((total, vacancy) => total + vacancyInProcessCount(vacancy.candidateCounts), 0);
}
describe("employer team fixtures", () => {
  it("validates every fixture at the module boundary", () => {
    expect(NEXO_TEAM_MEMBERS).toHaveLength(6);
    expect(parseTeamMembers(NEXO_TEAM_MEMBERS)).toEqual(NEXO_TEAM_MEMBERS);
    expect(teamMembersSchema.safeParse(NEXO_TEAM_MEMBERS).success).toBe(true);
    for (const member of NEXO_TEAM_MEMBERS) expect(teamMemberSchema.safeParse(member).success, member.id).toBe(true);
  });
  it("uses a closed role vocabulary and a prototype-local status vocabulary", () => {
    expectTypeOf<TeamMemberRole>().toEqualTypeOf<"owner" | "recruiter">();
    expectTypeOf<TeamMemberStatus>().toEqualTypeOf<"active" | "invited">();
    expect(TEAM_MEMBER_ROLES).toEqual(["owner", "recruiter"]);
    expect(TEAM_MEMBER_STATUSES).toEqual(["active", "invited"]);
    expect(TEAM_MEMBER_ROLE_LABELS).toEqual({ owner: "Propietario", recruiter: "Reclutador" });
    expect(TEAM_MEMBER_STATUS_LABELS).toEqual({ active: "Cuenta activa", invited: "Invitación pendiente" });
    for (const member of NEXO_TEAM_MEMBERS) {
      expect(TEAM_MEMBER_ROLE_LABELS[member.role].length, member.id).toBeGreaterThan(0);
      expect(TEAM_MEMBER_STATUS_LABELS[member.status].length, member.id).toBeGreaterThan(0);
    }
    // The local status set exists only because the backend has no such vocabulary.
    expect(modelSource).toMatch(/no member-account-status vocabulary/u);
  });
  it("pins the exact six identities, emails, and role/status mix", () => {
    expect(NEXO_TEAM_MEMBERS.map((member) => [member.id, member.fullName, member.email, member.role, member.status])).toEqual([
      ["tomas-rios", "Tomás Ríos", "tomas.rios@nexolabs.mx", "owner", "active"],
      ["valeria-ortiz", "Valeria Ortiz", "valeria.ortiz@nexolabs.mx", "recruiter", "active"],
      ["mateo-rios", "Mateo Ríos", "mateo.rios@nexolabs.mx", "recruiter", "active"],
      ["camila-duarte", "Camila Duarte", "camila.duarte@nexolabs.mx", "recruiter", "active"],
      ["andrea-pena", "Andrea Peña", "andrea.pena@nexolabs.mx", "recruiter", "active"],
      ["lucia-navarro", "Lucía Navarro", "lucia.navarro@nexolabs.mx", "recruiter", "invited"],
    ]);
    expect(new Set(NEXO_TEAM_MEMBERS.map((member) => member.id)).size).toBe(6);
    expect(new Set(NEXO_TEAM_MEMBERS.map((member) => member.email)).size).toBe(6);
    expect(NEXO_TEAM_MEMBERS.every((member) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(member.id))).toBe(true);
    expect(NEXO_TEAM_MEMBERS.every((member) => /@nexolabs\.mx$/u.test(member.email))).toBe(true);
  });
  it("keeps integer workload counters only and derives the frozen summary", () => {
    for (const member of NEXO_TEAM_MEMBERS) {
      expect(Object.keys(member.workload).sort(), member.id).toEqual(["inProcessCandidates", "ownedVacancies"]);
      for (const value of Object.values(member.workload)) {
        expect([Number.isInteger(value), value >= 0], member.id).toEqual([true, true]);
      }
    }
    expect(summarizeTeam(NEXO_TEAM_MEMBERS)).toEqual({ total: 6, owners: 1, recruiters: 5, active: 5, invited: 1 });
    expect(summarizeTeam([])).toEqual({ total: 0, owners: 0, recruiters: 0, active: 0, invited: 0 });
  });
  it("cross-checks every member workload against the vacancy portfolio", () => {
    expect(ownedVacanciesOf("Valeria Ortiz")).toBe(2);
    expect(inProcessOf("Valeria Ortiz")).toBe(10);
    expect(ownedVacanciesOf("Mateo Ríos")).toBe(2);
    expect(inProcessOf("Mateo Ríos")).toBe(11);
    expect(ownedVacanciesOf("Camila Duarte")).toBe(2);
    expect(inProcessOf("Camila Duarte")).toBe(9);
    for (const member of NEXO_TEAM_MEMBERS) {
      expect(member.workload.ownedVacancies, member.fullName).toBe(ownedVacanciesOf(member.fullName));
      expect(member.workload.inProcessCandidates, member.fullName).toBe(inProcessOf(member.fullName));
    }
    expect(NEXO_TEAM_MEMBERS.reduce((total, member) => total + member.workload.ownedVacancies, 0)).toBe(6);
    expect(NEXO_TEAM_MEMBERS.reduce((total, member) => total + member.workload.inProcessCandidates, 0)).toBe(30);
    expect(NEXO_VACANCIES).toHaveLength(6);
    expect(summarizeEmployerVacancies(NEXO_VACANCIES).inProcessCandidates).toBe(30);
  });
  it("freezes every fixture, nested workload, summary, and label dictionary", () => {
    for (const object of reachableObjects(NEXO_TEAM_MEMBERS)) expect(Object.isFrozen(object)).toBe(true);
    for (const dictionary of DICTIONARIES) expect(Object.isFrozen(dictionary)).toBe(true);
    expect(Object.isFrozen(summarizeTeam(NEXO_TEAM_MEMBERS))).toBe(true);
    for (const member of NEXO_TEAM_MEMBERS) {
      expect(() => Object.defineProperty(member, "fullName", { value: "Otra" })).toThrow();
      expect(() => Object.defineProperty(member.workload, "ownedVacancies", { value: 99 })).toThrow();
    }
  });
  it("rejects unknown vocabulary, malformed identity, bad counts, and extra keys", () => {
    const invalid = [
      { ...VALID_INPUT, role: "admin" },
      { ...VALID_INPUT, role: "Propietario" },
      { ...VALID_INPUT, status: "suspended" },
      { ...VALID_INPUT, status: " active" },
      { ...VALID_INPUT, workload: { ...VALID_INPUT.workload, ownedVacancies: -1 } },
      { ...VALID_INPUT, workload: { ...VALID_INPUT.workload, inProcessCandidates: 2.5 } },
      { ...VALID_INPUT, workload: { ...VALID_INPUT.workload, hired: 3 } },
      { ...VALID_INPUT, workload: { ownedVacancies: 1 } },
      { ...VALID_INPUT, id: "Tomás Ríos" },
      { ...VALID_INPUT, id: "tomas_rios" },
      { ...VALID_INPUT, id: "" },
      { ...VALID_INPUT, email: "tomas.rios" },
      { ...VALID_INPUT, email: "tomas.rios@nexolabs" },
      { ...VALID_INPUT, email: `a@b.co${"x".repeat(160)}` },
      { ...VALID_INPUT, email: " tomas.rios@nexolabs.mx" },
      { ...VALID_INPUT, email: "tomas.rios@nexolabs.mx " },
      { ...VALID_INPUT, fullName: "   " },
      { ...VALID_INPUT, fullName: "" },
      { ...VALID_INPUT, fullName: " Tomás Ríos" },
      { ...VALID_INPUT, fullName: "Tomás Ríos " },
      { ...VALID_INPUT, fullName: "x".repeat(121) },
      { ...VALID_INPUT, headline: "extra" },
    ];
    for (const [index, input] of invalid.entries()) expect(teamMemberSchema.safeParse(input).success, `invalid[${index}]`).toBe(false);
    expect(() => parseTeamMembers([{ ...VALID_INPUT, status: "nope" }])).toThrow();
    // The boundary validates the whole list: a single bad member or a non-array rejects it.
    expect(teamMembersSchema.safeParse({ ...VALID_INPUT }).success).toBe(false);
    expect(teamMembersSchema.safeParse([VALID_INPUT, { ...VALID_INPUT, role: "admin" }]).success).toBe(false);
    expect(teamMembersSchema.safeParse([VALID_INPUT]).success).toBe(true);
  });
  it("enforces unique ids, case-insensitive unique emails, and exactly one owner", () => {
    const owner = { ...VALID_INPUT };
    const recruiter = { ...VALID_INPUT, id: "valeria-ortiz", fullName: "Valeria Ortiz", email: "valeria.ortiz@nexolabs.mx", role: "recruiter" };
    expect(teamMembersSchema.safeParse([owner, recruiter]).success).toBe(true);
    expect(teamMembersSchema.safeParse([owner, { ...recruiter, id: owner.id }]).success).toBe(false);
    expect(teamMembersSchema.safeParse([owner, { ...recruiter, email: "TOMAS.RIOS@nexolabs.mx" }]).success).toBe(false);
    expect(teamMembersSchema.safeParse([recruiter]).success).toBe(false);
    expect(teamMembersSchema.safeParse([owner, { ...recruiter, role: "owner" }]).success).toBe(false);
    expect(() => parseTeamMembers([recruiter])).toThrow();
  });
  it("stays free of React, browser, transport, and vacancy-fixture coupling", () => {
    const modulesOf = (source: string): readonly string[] => [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))];
    expect(modulesOf(modelSource)).toEqual(["zod"]);
    expect(modulesOf(fixtureSource)).toEqual(["./model"]);
    for (const source of [modelSource, fixtureSource]) {
      expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|axios|\/api\/|https?:\/\//u);
      expect(source).not.toMatch(/localStorage|sessionStorage|document\.|window\.|navigator\./u);
      expect(source).not.toMatch(/useState\(|useEffect\(|from "react"|"use client"/u);
      expect(source).not.toMatch(/Date\.now|Math\.random|new Date\(|randomUUID/u);
      expect(source).not.toMatch(/prototype-vacancies|prototype-candidates|NEXO_VACANCIES|employer-vacancies/u);
    }
  });
});
