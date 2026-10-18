import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { redirect } from "next/navigation";

import Page from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }),
}));

const source = readFileSync("src/app/(empresa)/empresa/vacantes/nueva/page.tsx", "utf8");

beforeEach(() => vi.clearAllMocks());

describe("/empresa/vacantes/nueva legacy route", () => {
  it("redirects on the server to the canonical draft editor", () => {
    expect(() => Page()).toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/empresa/vacantes/borradores/nuevo");
  });

  it("stays server-only without mounting the legacy create form", () => {
    expect(source).not.toContain("use client");
    expect(source).not.toContain("features/jobs/create");
    expect(source).not.toContain("CreateVacancyForm");
    expect(source).not.toContain("CreateVacancyHeader");
    expect(source).not.toMatch(/useRouter|useEffect|window\.location|fetch\(/u);
  });
});
