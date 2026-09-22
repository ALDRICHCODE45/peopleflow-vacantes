import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { readCookie, pathnameMock } = vi.hoisted(() => ({
  readCookie: vi.fn(),
  pathnameMock: vi.fn<() => string | null>(() => "/candidato/dashboard"),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => readCookie(name) }) }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));

import CandidateLayout from "./layout";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";
import DashboardPage, { metadata as dashboardMetadata } from "./candidato/dashboard/page";
import PostulacionesPage, { metadata as postulacionesMetadata } from "./candidato/postulaciones/page";
import PerfilPage, { metadata as perfilMetadata } from "./candidato/perfil/page";
import CvsPage, { metadata as cvsMetadata } from "./candidato/cvs/page";
import CuentaPage, { metadata as cuentaMetadata } from "./candidato/cuenta/page";

type Destination = { segment: string; title: string; Page: () => React.JSX.Element; metadata: { title?: unknown } };
const DESTINATIONS: Destination[] = [
  { segment: "dashboard", title: "Dashboard", Page: DashboardPage, metadata: dashboardMetadata },
  { segment: "postulaciones", title: "Postulaciones", Page: PostulacionesPage, metadata: postulacionesMetadata },
  { segment: "perfil", title: "Perfil", Page: PerfilPage, metadata: perfilMetadata },
  { segment: "cvs", title: "CVs", Page: CvsPage, metadata: cvsMetadata },
  { segment: "cuenta", title: "Cuenta", Page: CuentaPage, metadata: cuentaMetadata },
];
const SEGMENTS = DESTINATIONS.map((destination) => destination.segment);
const PLACEHOLDER_DESTINATIONS = DESTINATIONS.filter((destination) => destination.segment !== "dashboard");
const routeSource = (segment: string) => readFileSync(join(process.cwd(), `src/app/(candidato)/candidato/${segment}/page.tsx`), "utf8");

function stubBrowserApis(innerWidth = 1280) {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", innerWidth);
}

const renderLayout = async () => render(await CandidateLayout({ children: <p>contenido</p> }));
const sidebarState = () => document.querySelector("[data-slot='sidebar']")?.getAttribute("data-state");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  readCookie.mockReset();
  pathnameMock.mockReturnValue("/candidato/dashboard");
  localStorage.clear();
});

describe("(candidato) route-group layout owns the single candidate shell", () => {
  beforeEach(stubBrowserApis);

  it("mounts exactly one candidate frame with one main landmark around the route children", async () => {
    readCookie.mockReturnValue(undefined);
    await renderLayout();
    expect(document.querySelectorAll("[data-slot='sidebar-wrapper']")).toHaveLength(1);
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(screen.getByText("contenido")).toBeInTheDocument();
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

describe("candidate destinations resolve as honest content-only routes", () => {
  beforeEach(stubBrowserApis);

  it.each(DESTINATIONS)("$title declares truthful metadata and exactly one matching heading", ({ title, Page, metadata }) => {
    expect(metadata.title).toBe(title);
    render(<CandidateShell><Page /></CandidateShell>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it.each(PLACEHOLDER_DESTINATIONS)("$title renders a local preview with an honest disclosure", ({ title, Page }) => {
    render(<CandidateShell><Page /></CandidateShell>);
    const preview = document.querySelector(`[data-pf-destination="${title}"] [data-pf-destination-preview]`);
    expect(preview).not.toBeNull();
    const disclosure = preview!.querySelector("[data-pf-destination-disclosure]");
    expect(disclosure).toHaveAttribute("role", "note");
    expect(disclosure).toHaveTextContent(/no guarda cambios/i);
    expect(preview!.querySelectorAll("li").length).toBeGreaterThanOrEqual(2);
  });

  it("mounts the verified dashboard overview instead of a destination preview", () => {
    render(<CandidateShell><DashboardPage /></CandidateShell>);
    expect(document.querySelector("[data-pf-candidate-overview]")).not.toBeNull();
    expect(document.querySelector('[data-pf-destination="Dashboard"]')).toBeNull();
  });

  it.each(DESTINATIONS)("$title activates only its own sidebar destination", ({ segment, title, Page }) => {
    pathnameMock.mockReturnValue(`/candidato/${segment}`);
    render(<CandidateShell><Page /></CandidateShell>);
    const nav = document.querySelector("[data-slot='sidebar-content']") as HTMLElement;
    const active = within(nav).getAllByRole("link").filter((link) => link.hasAttribute("data-active")).map((link) => link.textContent);
    expect(active).toEqual([title]);
  });

  it("keeps every candidate route content-only and free of side effects", () => {
    for (const segment of SEGMENTS) {
      const source = routeSource(segment);
      for (const owned of ["SidebarProvider", "Sidebar", "CandidateShell", "candidate-theme", "next/headers", "next/navigation"]) {
        expect(source, `${segment} must not own ${owned}`).not.toContain(owned);
      }
      for (const fake of ["use client", "fetch(", "localStorage", "document.cookie", "useState", "onClick", "<form", "<input", "window."]) {
        expect(source, `${segment} must not fake ${fake}`).not.toContain(fake);
      }
    }
  });
});
