import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createFlightRouterStateFromLoaderTree } from "next/dist/server/app-render/create-flight-router-state-from-loader-tree";
import type { LoaderTree } from "next/dist/server/lib/app-dir-module";
import * as route from "./page";

const { getCookie, getAssessment } = vi.hoisted(() => ({ getCookie: vi.fn(), getAssessment: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: getCookie }) }));
vi.mock("@/features/psychometrics/client", () => ({ getAssessment }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
const token = "private-assessment-token";
beforeEach(() => {
  vi.clearAllMocks();
  getAssessment.mockResolvedValue({ ok: false, reason: "assessment_unavailable", reference: {} });
});
afterEach(cleanup);
it("without a cookie renders the identical neutral unavailable screen without backend access", async () => {
  getCookie.mockReturnValue(undefined);
  render(await route.default());
  expect(getCookie).toHaveBeenCalledWith("pf_assessment");
  expect(screen.getByRole("heading", { name: "Esta evaluación no está disponible" })).toBeTruthy();
  expect(getAssessment).not.toHaveBeenCalled();
});
it("reads the cookie only server-side and never passes the token to a component", async () => {
  getCookie.mockReturnValue({ value: token });
  const page = await route.default();
  expect(getAssessment).toHaveBeenCalledWith({ access: "public", assessmentToken: token });
  expect(JSON.stringify(page.props)).not.toContain(token);
  expect(page.props).not.toHaveProperty("token");
  render(page);
  expect(document.body.innerHTML).not.toContain(token);
  expect(screen.getByRole("heading", { name: "Esta evaluación no está disponible" })).toBeTruthy();
  expect(route.metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer" });
  expect([route.dynamic, route.revalidate, route.fetchCache, route.runtime]).toEqual(["force-dynamic", 0, "force-no-store", "nodejs"]);
});
it("has only a static page; the token segment is an exchange handler, not a page", () => {
  const directory = join(process.cwd(), "src/app/(public)/evaluacion");
  expect(existsSync(join(directory, "page.tsx"))).toBe(true);
  expect(existsSync(join(directory, "[token]/route.ts"))).toBe(true);
  const pages = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? pages(join(path, entry.name)) : entry.name === "page.tsx" ? [join(path, entry.name)] : []);
  expect(pages(directory)).toEqual([join(directory, "page.tsx")]);
});
it("Next's real Flight router-state builder never serializes the cookie token on the static loader tree", () => {
  const tree: LoaderTree = ["", { children: ["(public)", { children: ["evaluacion", { children: ["__PAGE__", {}, {}] }, {}] }, {}] }, {}];
  const resolveDynamic = vi.fn((segment: string) => segment === "[token]" ? { param: "token", value: token, type: "d" as const, treeSegment: ["token", token, "d"] as [string, string, "d"] } : null);
  const state = createFlightRouterStateFromLoaderTree(tree, resolveDynamic, {});
  expect(JSON.stringify(state)).toContain("evaluacion");
  expect(JSON.stringify(state)).not.toContain(token);
  expect(resolveDynamic.mock.calls.map(([segment]) => segment)).not.toContain("[token]");
});
