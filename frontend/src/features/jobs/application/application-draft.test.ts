import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { vacancyApplicationHref } from "./application-draft";

const SOURCE = readFileSync(join(process.cwd(), "src", "features", "jobs", "application", "application-draft.ts"), "utf8");

describe("application route helper", () => {
  it("builds the canonical postular route as a plain string", () => {
    expect(vacancyApplicationHref("11111111-1111-1111-1111-111111111111")).toBe("/vacantes/11111111-1111-1111-1111-111111111111/postular");
    expectTypeOf(vacancyApplicationHref("x")).toEqualTypeOf<string>();
  });

  it("stays a dependency-free pure helper", () => {
    expect(SOURCE).not.toMatch(/\bimport\b|fetch\(|localStorage|window\.|document\.|useRouter|Math\.random|Date\.now/u);
  });
});
