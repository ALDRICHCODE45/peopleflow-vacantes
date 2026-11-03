import { afterEach, expect, it, vi } from "vitest";
import Page from "./page";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/features/vacancy-team/prototype", () => ({ TeamPrototype: vi.fn(() => null) }));
vi.mock("@/features/vacancy-team/api", () => ({ TeamApi: vi.fn(() => null) }));
afterEach(() => vi.unstubAllEnvs());
it("selects real reads only for api in development", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", "api");
  const params = Promise.resolve({ jobId: "10000000-0000-4000-8000-000000000001" });
  expect((await Page({ params, searchParams: Promise.resolve({ fixture: "shared" }) })).props).toEqual({ vacancyId: (await params).jobId });
});
it.each(["api", "other"])("hides %s in production", async flag => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", flag);
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
});
it.each(["production", "test"])("never exposes the fixture route in %s even with the flag", async environment => {
  vi.stubEnv("NODE_ENV", environment);
  vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", "1");
  await expect(Page({ searchParams: Promise.resolve({ fixture: "owner" }) })).rejects.toThrow("NEXT_NOT_FOUND");
});
it("withholds the route by default in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", "");
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
});
it("selects a fixture only after explicit development opt-in", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", "1");
  expect((await Page({ searchParams: Promise.resolve({ fixture: "shared" }) })).props).toMatchObject({ fixture: "shared" });
  expect((await Page({ searchParams: Promise.resolve({ fixture: "unknown" }) })).props).toMatchObject({ fixture: "owner" });
});
