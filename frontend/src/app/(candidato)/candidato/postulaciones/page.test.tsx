import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ status: "ready", result: { ok: true, data: { role: "candidate" } } }) }));
import { readFileSync } from "node:fs";
import { join } from "node:path";
vi.mock("next/navigation", () => ({ usePathname: () => "/candidato/postulaciones" }));
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn() }));
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import { page, id } from "@/features/candidate-applications/test-fixtures";
vi.mock("@/features/psychometrics/workspace/load", () => ({ loadWorkspaceAssessments: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }) }));
import { loadWorkspaceAssessments } from "@/features/psychometrics/workspace/load";
import PostulacionesPage, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: page });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("keeps metadata, one header and one live workspace inside the existing shell", async () => {
  expect(metadata.title).toBe("Postulaciones"); render(<CandidateShell>{await PostulacionesPage()}</CandidateShell>);
  expect(loadWorkspaceAssessments).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(document.querySelectorAll("[data-pf-applications-workspace]")).toHaveLength(1);
  expect(await screen.findByRole("link", { name: "Backend Go" })).toHaveAttribute("href", `/vacantes/${id}`);
  expect(screen.getByText("Enviada")).toBeVisible();
  const nav = document.querySelector("[data-slot='sidebar-content']")!;
  expect(Array.from(nav.querySelectorAll("a[data-active]")).map(link => link.textContent)).toEqual(["Postulaciones"]);
});
it("passes no prototype fixtures and leaves fetching and state in the workspace", () => {
  const source = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/postulaciones/page.tsx"), "utf8");
  expect(source).toContain("<ApplicationsWorkspace assessments={await loadWorkspaceAssessments()} />");
  expect(source).not.toMatch(/prototype-|CANDIDATE_APPLICATIONS|CandidateShell|use client|useEffect|fetch\(/);
});
