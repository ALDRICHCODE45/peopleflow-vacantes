import { describe, expect, it } from "vitest";
import { jobItemSchema, jobsListSchema } from "./schemas";

const JOB_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const COMPANY_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const BASE_JOB = {
  id: JOB_ID, title: "Ingeniera Frontend", description: "Construye la experiencia de vacantes.",
  work_mode: "remote", employment_type: "full_time", seniority: "senior", salary_currency: "MXN",
  company: { id: COMPANY_ID, name: "Acme" },
};
const validJob = (overrides: Record<string, unknown> = {}) => ({ ...BASE_JOB, ...overrides });
const itemParses = (job: unknown, msg?: string) => expect(() => jobItemSchema.parse(job), msg).not.toThrow();
const itemThrows = (job: unknown, msg?: string) => expect(() => jobItemSchema.parse(job), msg).toThrow();

describe("jobs wire schemas", () => {
  it("accepts a valid list envelope and detail shape, including omitted optional fields", () => {
    const list = jobsListSchema.parse({ items: [validJob()], next_cursor: "cursor-1" });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.title).toBe("Ingeniera Frontend");
    const item = jobItemSchema.parse(validJob());
    for (const optional of ["location", "salary_min", "salary_max", "published_at"] as const)
      expect(item[optional]).toBeUndefined();
    expect(jobsListSchema.parse({ items: [] }).next_cursor).toBeUndefined();
  });

  it("accepts every exact work-mode, employment-type, seniority, and MXN|USD currency value", () => {
    const accepted: Record<string, string[]> = {
      work_mode: ["onsite", "remote", "hybrid"], employment_type: ["full_time", "part_time", "contract", "internship"],
      seniority: ["intern", "junior", "mid", "senior", "lead"], salary_currency: ["MXN", "USD"],
    };
    for (const [field, values] of Object.entries(accepted))
      for (const value of values)
        itemParses(validJob({ [field]: value }), `${field}=${value}`);
  });

  it("rejects null, invalid, and missing known fields", () => {
    for (const invalid of [
      validJob({ location: null }), validJob({ published_at: null }),
      validJob({ salary_min: null }), validJob({ salary_max: null }), validJob({ title: "" }),
      validJob({ company: { id: COMPANY_ID, name: "" } }), validJob({ salary_currency: undefined }),
    ])
      itemThrows(invalid);
    for (const list of [
      { items: [validJob()], next_cursor: null }, {}, { items: null }, { items: [], next_cursor: "" },
    ])
      expect(() => jobsListSchema.parse(list)).toThrow();
  });

  it("rejects anything outside the exact backend enums and the exact MXN|USD currency", () => {
    for (const [field, value] of [
      ["work_mode", "telecommute"], ["employment_type", "freelance"],
      ["seniority", "principal"], ["salary_currency", "EUR"],
      ["work_mode", "remote "], ["salary_currency", "mxn"],
    ] as const)
      itemThrows(validJob({ [field]: value }), `${field}=${value}`);
  });

  it("requires integer salary bounds and UUID identifiers when present", () => {
    itemParses(validJob({ salary_min: 25000, salary_max: 40000 }));
    for (const invalid of [
      validJob({ salary_min: 2500.5 }), validJob({ salary_max: 2500.5 }), validJob({ id: "not-a-uuid" }),
      validJob({ company: { id: "123", name: "Acme" } }),
    ])
      itemThrows(invalid);
  });

  it("requires ISO timestamps with an explicit offset for published_at", () => {
    for (const offset of ["2026-01-15T12:00:00Z", "2026-01-15T06:00:00-06:00"])
      itemParses(validJob({ published_at: offset }));
    for (const invalid of ["2026-01-15T12:00:00", "ayer"])
      itemThrows(validJob({ published_at: invalid }));
  });

  it("strips unknown additive keys from the job item and the nested company", () => {
    const item = jobItemSchema.parse(validJob({
      status: "published", updated_at: "2026-02-01T00:00:00Z",
      company: { id: COMPANY_ID, name: "Acme", logo_url: "https://acme.mx/logo.png", verified: true },
    }));
    for (const stripped of ["status", "updated_at", "company.logo_url", "company.verified"]) expect(item).not.toHaveProperty(stripped);
    expect(item).toMatchObject({ company: { id: COMPANY_ID, name: "Acme" } });
  });
});
