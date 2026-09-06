import { describe, expect, expectTypeOf, it } from "vitest";

import { jobItemSchema, jobsListSchema } from "./schemas";
import type { JobItem, JobsList } from "./types";

const JOB_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const COMPANY_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";

const validJob = {
  id: JOB_ID,
  title: "Ingeniera Frontend",
  description: "Construye la experiencia de vacantes.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  company: { id: COMPANY_ID, name: "Acme" },
};

describe("jobs schema-inferred type contract", () => {
  it("types parsed schema output exactly as the exported JobItem and JobsList", () => {
    const item = jobItemSchema.parse(validJob);
    const list = jobsListSchema.parse({ items: [validJob], next_cursor: "cursor-1" });
    expectTypeOf(item).toEqualTypeOf<JobItem>();
    expectTypeOf(list).toEqualTypeOf<JobsList>();
    expectTypeOf<JobsList["items"]>().toEqualTypeOf<JobItem[]>();
    expect(item.title).toBe("Ingeniera Frontend");
    expect(list.items).toHaveLength(1);
  });

  it("pins the exact wire enums, scalars, and optional-field omission in the validated shape", () => {
    expectTypeOf<JobItem["work_mode"]>().toEqualTypeOf<"onsite" | "remote" | "hybrid">();
    expectTypeOf<JobItem["employment_type"]>().toEqualTypeOf<
      "full_time" | "part_time" | "contract" | "internship"
    >();
    expectTypeOf<JobItem["seniority"]>().toEqualTypeOf<
      "intern" | "junior" | "mid" | "senior" | "lead"
    >();
    expectTypeOf<JobItem["salary_currency"]>().toEqualTypeOf<"MXN" | "USD">();
    expectTypeOf<JobItem["id"]>().toEqualTypeOf<string>();
    expectTypeOf<JobItem["company"]>().toEqualTypeOf<{ id: string; name: string }>();
    expectTypeOf<JobItem["location"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<JobItem["salary_min"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<JobItem["salary_max"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<JobItem["published_at"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<JobsList["next_cursor"]>().toEqualTypeOf<string | undefined>();
  });
});
