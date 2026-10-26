import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ status: "ready", result: { ok: true, data: { role: "candidate" } } }) }));
import { readFileSync } from "node:fs";
vi.mock("next/navigation", () => ({ usePathname: () => "/candidato/cvs" }));
vi.mock("@/features/candidate-cvs/actions", () => ({ loadCvsAction: vi.fn(), renameCvAction: vi.fn(), deleteCvAction: vi.fn() }));
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { library, cv } from "@/features/candidate-cvs/test-fixtures";
import Page, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280); vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: library });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("candidate CV route", () => {
  it("keeps metadata and one shell/H1 with the real library workspace", async () => {
    expect(metadata.title).toBe("CVs");
    render(<CandidateShell><Page /></CandidateShell>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^CVs$/);
    expect(await screen.findByRole("heading", { name: cv.name })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-pf-cv-workspace]")).toHaveLength(1);
    const nav = document.querySelector("[data-slot='sidebar-content']") as HTMLElement;
    expect(within(nav).getAllByRole("link").filter(link => link.hasAttribute("data-active")).map(link => link.textContent)).toEqual(["CVs"]);
  });
  it("uses no prototype data or second identity/session authority", () => {
    const source = readFileSync("src/app/(candidato)/candidato/cvs/page.tsx", "utf8");
    expect(source).toContain("<CvWorkspace />");
    expect(source).not.toMatch(/prototype|CANDIDATE_CVS|fetch\(|next\/headers|useSession|CandidateShell|use client/);
  });
});
