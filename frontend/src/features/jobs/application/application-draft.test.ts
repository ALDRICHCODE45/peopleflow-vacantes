import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { applicationChannel, careersSiteVacancyHref, vacancyApplicationHref } from "./application-draft";

const SOURCE = readFileSync(join(process.cwd(), "src", "features", "jobs", "application", "application-draft.ts"), "utf8");

describe("application route helper", () => {
  it("builds the canonical postular route as a plain string", () => {
    expect(vacancyApplicationHref("11111111-1111-1111-1111-111111111111")).toBe("/vacantes/11111111-1111-1111-1111-111111111111/postular");
    expectTypeOf(vacancyApplicationHref("x")).toEqualTypeOf<string>();
  });

  it("carries the careers site origin only into the postular route it was asked for", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(careersSiteVacancyHref(id)).toBe(`/vacantes/${id}?origen=sitio`);
    expect(vacancyApplicationHref(id, "careers_site")).toBe(`/vacantes/${id}/postular?origen=sitio`);
    expect(vacancyApplicationHref(id, "portal")).toBe(`/vacantes/${id}/postular`);
  });

  it("maps only the exact origen=sitio value to the careers site channel", () => {
    expect(applicationChannel("sitio")).toBe("careers_site");
    for (const origin of [undefined, null, "", "Sitio", "sitio ", "portal", "careers_site", ["sitio"], ["sitio", "sitio"]]) expect(applicationChannel(origin)).toBe("portal");
  });

  it("stays a dependency-free pure helper", () => {
    expect(SOURCE).not.toMatch(/\bimport\b|fetch\(|localStorage|window\.|document\.|useRouter|Math\.random|Date\.now/u);
  });
});
