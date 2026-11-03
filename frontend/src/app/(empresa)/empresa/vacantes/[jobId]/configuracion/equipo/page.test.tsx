import { afterEach, expect, it, vi } from "vitest";
import Page from "./page";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/features/vacancy-team/prototype", () => ({ TeamPrototype: vi.fn(() => null) }));
afterEach(() => vi.unstubAllEnvs());
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
