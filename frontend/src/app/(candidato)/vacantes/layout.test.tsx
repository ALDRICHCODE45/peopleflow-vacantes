import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const { pathname } = vi.hoisted(() => ({ pathname: vi.fn(() => "/vacantes") }));
vi.mock("next/navigation", () => ({ usePathname: pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/features/identity/identity-session", () => ({ IdentitySessionProvider: ({ children }: { children: React.ReactNode }) => children, useIdentity: () => ({ status: "loading" }) }));
vi.mock("@/features/identity/area-guards", () => ({ CandidateGuard: ({ children }: { children: React.ReactNode }) => <section data-testid="guard">{children}</section> }));
import GroupLayout from "../layout";
import PrivateLayout from "../candidato/layout";
import PublicLayout from "../../(public)/layout";
import VacancyLayout from "@/app/(candidato)/vacantes/layout";
beforeEach(() => {
  pathname.mockReturnValue("/vacantes");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([
  { path: "/vacantes", title: "Vacantes", parent: null },
  { path: "/vacantes/abc", title: "Detalle de la vacante", parent: { label: "Vacantes", href: "/vacantes" } },
  { path: "/vacantes/abc/postular", title: "Postulación", parent: { label: "Detalle de la vacante", href: "/vacantes/abc" } },
])("$path keeps one h1 and its contextual breadcrumb inside the public app frame", async ({ path, title, parent }) => {
  pathname.mockReturnValue(path);
  render(await GroupLayout({ children: <VacancyLayout><h1>Contenido de la página</h1></VacancyLayout> }));
  expect(document.querySelectorAll("[data-slot=sidebar-wrapper]")).toHaveLength(1);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  const header = document.querySelector("header")!;
  const breadcrumb = within(header).getByRole("navigation", { name: "Ruta de navegación" });
  expect(within(breadcrumb).getByText(title, { exact: true })).toHaveAttribute("aria-current", "page");
  expect(breadcrumb.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  if (parent) {
    const ancestor = within(breadcrumb).getByRole("link", { name: parent.label });
    expect(ancestor).toHaveAttribute("href", parent.href);
    expect(ancestor).toHaveClass("min-h-10", "inline-flex", "items-center");
    expect(within(breadcrumb).getAllByRole("link")).toHaveLength(1);
  } else expect(within(breadcrumb).queryByRole("link")).toBeNull();
  expect(within(breadcrumb).queryByRole("heading")).toBeNull();
  expect(within(header).getByRole("button", { name: /toggle sidebar/i })).toBeVisible();
  expect(within(header).getByRole("button", { name: "Cambiar tema" })).toBeVisible();
  expect(document.querySelector("[data-pf-public-navbar]")).toBeNull();
  expect(document.querySelector("footer")).toBeNull();
  expect(screen.queryByTestId("guard")).toBeNull();
});
it("updates contextual crumbs on client navigation without replacing the shared frame", async () => {
  const tree = () => GroupLayout({ children: <VacancyLayout><h1>Contenido</h1></VacancyLayout> });
  const { rerender } = render(await tree());
  const shell = document.querySelector("[data-slot=sidebar-wrapper]");
  for (const path of ["/vacantes/abc", "/vacantes/abc/postular", "/vacantes"]) {
    pathname.mockReturnValue(path);
    rerender(await tree());
    expect(document.querySelector("[data-slot=sidebar-wrapper]")).toBe(shell);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const header = document.querySelector("header")!;
    const breadcrumb = within(header).getByRole("navigation", { name: "Ruta de navegación" });
    expect(breadcrumb.querySelector('[aria-current="page"]')).toHaveTextContent(path.endsWith("postular") ? "Postulación" : path === "/vacantes" ? "Vacantes" : "Detalle de la vacante");
  }
});
it("only the literal candidato segment applies the client guard", async () => {
  render(await GroupLayout({ children: <PrivateLayout><h1>Privado</h1></PrivateLayout> }));
  expect(within(screen.getByTestId("guard")).getByRole("heading", { name: "Privado" })).toBeVisible();
});
it("the companies route group keeps PublicShell chrome outside the app frame", () => {
  render(<PublicLayout><h1>Empresa</h1></PublicLayout>);
  expect(document.querySelector("[data-pf-public-navbar]")).not.toBeNull();
  expect(document.querySelector("footer")).not.toBeNull();
  expect(document.querySelector("[data-slot=sidebar-wrapper]")).toBeNull();
});
