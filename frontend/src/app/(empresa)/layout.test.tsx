import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { readCookie } = vi.hoisted(() => ({ readCookie: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => readCookie(name) }),
}));

// SSR frame tests; real role guards are exercised in identity/flow.test.tsx.
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ result: { ok: true, data: { role: "recruiter" } } }), IdentitySessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/features/identity/area-guards", () => ({ EmployerGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import EmployerLayout from "./layout";

// The routes below the group must stay content-only: the layout owns the shell.
const routeSources = [
  "src/app/(empresa)/empresa/dashboard/page.tsx",
  "src/app/(empresa)/empresa/vacantes/nueva/page.tsx",
  "src/app/(empresa)/empresa/sitio/page.tsx",
].map((path) => readFileSync(join(process.cwd(), path), "utf8"));
function stubBrowserApis() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
}

const frameCount = () => document.querySelectorAll("[data-slot='sidebar-wrapper']").length;
const sidebarState = () =>
  document.querySelector("[data-slot='sidebar']")?.getAttribute("data-state");

const renderLayout = async () =>
  render(await EmployerLayout({ children: <p>contenido</p> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  readCookie.mockReset();
});

describe("(empresa) route-group layout owns the single employer shell", () => {
  beforeEach(stubBrowserApis);

  it("adds the client guard without moving session resolution into the RSC", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(empresa)/layout.tsx"), "utf8");
    expect(source).toContain("<IdentitySessionProvider>");
    expect(source).toContain("<EmployerGuard>");
    expect(source).not.toMatch(/getActionAccessToken|getServerSession/);
  });

  it("mounts exactly one employer frame around the route children", async () => {
    readCookie.mockReturnValue(undefined);
    await renderLayout();
    expect(frameCount()).toBe(1);
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });

  it("offers the canonical draft editor through the shared shell", async () => {
    await renderLayout();
    const create = screen.getByRole("button", { name: "Nueva vacante" });
    expect(create.closest("form")).toHaveAttribute("action", "/empresa/vacantes/borradores/nuevo");
    expect(create.closest("form")).toHaveAttribute("method", "get");
  });

  it("leaves no route owning its own provider, sidebar or dashboard theme", () => {
    for (const source of routeSources) {
      for (const owned of [
        "SidebarProvider",
        "AppSidebar",
        "SidebarInset",
        "dashboard-01-theme.module.css",
      ]) {
        expect(source, `route must not own ${owned}`).not.toContain(owned);
      }
    }
  });

  it("starts collapsed only for the exact false cookie value", async () => {
    readCookie.mockReturnValue({ value: "false" });
    await renderLayout();
    expect(readCookie).toHaveBeenCalledWith("sidebar_state");
    expect(sidebarState()).toBe("collapsed");
  });

  it("starts expanded when the cookie is absent, malformed or true", async () => {
    for (const value of [undefined, { value: "true" }, { value: "0" }, { value: "" }]) {
      readCookie.mockReturnValue(value);
      await renderLayout();
      expect(sidebarState(), `cookie ${JSON.stringify(value)}`).toBe("expanded");
      cleanup();
    }
  });
});
