import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { IdentityState } from "@/features/identity/identity-session";
const { viewer } = vi.hoisted(() => ({ viewer: { status: "loading", result: undefined } as Pick<IdentityState, "status" | "result"> }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => viewer }));
vi.mock("next/navigation", () => ({ usePathname: () => "/vacantes/abc", useSearchParams: () => new URLSearchParams("q=Go") }));
import { CandidateShell } from "./candidate-shell";
import { CandidateHeader } from "./candidate-header";
import { JobDetailView } from "@/features/jobs/components/JobDetailView";
import { vacancyDetail } from "@/features/jobs/api/public-fixtures";
const login = "/candidato/login?next=%2Fvacantes%2Fabc%3Fq%3DGo";
function role(value: "candidate" | "recruiter" | null) {
  viewer.status = "ready";
  viewer.result = { ok: true, data: { role: value, user: { id: "id", full_name: "Ana Pérez", email: "ana@example.com" } } } as IdentityState["result"];
}
beforeEach(() => {
  viewer.status = "loading"; viewer.result = undefined;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function frame(collapsed = false) { return render(<CandidateShell defaultOpen={!collapsed}><CandidateHeader /><h2>Contenido</h2></CandidateShell>); }
function onlyVacancies() {
  const nav = document.querySelector("[data-slot=sidebar-content]") as HTMLElement;
  expect(within(nav).getAllByRole("link").map(link => link.textContent)).toEqual(["Vacantes"]);
  expect(within(nav).getByRole("link", { name: "Vacantes" })).toHaveAttribute("data-active");
}
it("loading exposes only Vacantes and a busy footer skeleton, never private items", () => {
  role("candidate"); viewer.status = "loading"; frame(); onlyVacancies();
  const footer = document.querySelector("[data-slot=sidebar-footer]")!;
  expect(footer.querySelector("[aria-busy=true]")).not.toBeNull();
  expect(footer.querySelector("[data-slot=skeleton]")).not.toBeNull();
  expect(screen.queryByRole("button", { name: /Ana Pérez/ })).toBeNull();
});
it.each(["unauthenticated", "error"])("%s shows the visitor card with return links and no private items", (mode) => {
  viewer.status = mode === "error" ? "ready" : "unauthenticated";
  if (mode === "error") viewer.result = { ok: false, reason: "no_response", reference: {} };
  frame(); onlyVacancies();
  expect(screen.getByText("Guarda tu búsqueda y sigue tus postulaciones")).toBeVisible();
  expect(screen.getByRole("link", { name: "Crear cuenta" })).toHaveAttribute("href", login);
  const signIn = screen.getByRole("link", { name: "Iniciar sesión" });
  expect(signIn).toHaveAttribute("href", login);
  expect(signIn).toHaveClass("border-border");
  expect(signIn).not.toHaveClass("border-transparent");
  expect(screen.getByRole("link", { name: "¿Eres empresa? Publica vacantes" })).toHaveAttribute("href", "/empresa/login");
  const mobile = within(document.querySelector("header")!).getByRole("link", { name: "Ingresar" });
  expect(mobile).toHaveAttribute("href", login); expect(mobile).toHaveClass("md:hidden", "border-border");
  expect(mobile).not.toHaveClass("border-transparent");
});
it("candidate keeps private groups and account menu alongside the active Vacantes item", () => {
  role("candidate"); frame();
  for (const name of ["Vacantes", "Dashboard", "Postulaciones", "Vacantes guardadas", "Perfil", "CVs", "Configuración"]) expect(screen.getByRole("link", { name })).toBeVisible();
  expect(screen.getByRole("button", { name: /Ana Pérez/ })).toBeVisible();
  expect(screen.queryByText("Guarda tu búsqueda y sigue tus postulaciones")).toBeNull();
});
it("recruiter has only Vacantes, company notice and company account", () => {
  role("recruiter"); frame(); onlyVacancies();
  expect(screen.getByText("Estás viendo las vacantes como las ve un candidato")).toBeVisible();
  expect(screen.getByRole("link", { name: "Ir a mi panel" })).toHaveAttribute("href", "/empresa/dashboard");
  expect(screen.getByRole("button", { name: /Ana Pérez.*Empresa/ })).toBeVisible();
});
it("collapsed recruiter retains a 40px panel shortcut and company account", () => {
  role("recruiter"); frame(true); onlyVacancies();
  const target = screen.getByRole("link", { name: "Ir a mi panel" });
  expect(target).toHaveAttribute("href", "/empresa/dashboard");
  expect(target.className).toContain("size-10");
  expect(target).toHaveAttribute("data-base-ui-tooltip-trigger");
  expect(screen.getByRole("button", { name: /Ana Pérez.*Empresa/ })).toBeVisible();
});
it("null-role offers account completion without private links", () => {
  role(null); frame(); onlyVacancies();
  expect(screen.getByRole("link", { name: "Completa tu cuenta" })).toHaveAttribute("href", "/candidato/ingresar?next=%2Fvacantes%2Fabc%3Fq%3DGo");
});
it("collapsed visitor has one 40px login target with tooltip instead of the card", () => {
  viewer.status = "unauthenticated"; frame(true); onlyVacancies();
  const footer = document.querySelector("[data-slot=sidebar-footer]") as HTMLElement;
  const target = within(footer).getByRole("link", { name: "Iniciar sesión" });
  expect(within(footer).getAllByRole("link")).toHaveLength(1);
  expect(target).toHaveAttribute("href", login);
  expect(target.className).toContain("size-10");
  expect(target).toHaveAttribute("data-base-ui-tooltip-trigger");
  expect(within(footer).queryByText("Guarda tu búsqueda y sigue tus postulaciones")).toBeNull();
});
it.each(["loading", "visitor", "pending", "candidate", "recruiter"] as const)("%s keeps every interactive rail row centered at 40px", mode => {
  if (mode === "visitor") viewer.status = "unauthenticated";
  else if (mode !== "loading") role(mode === "pending" ? null : mode);
  frame(true);
  const sidebar = document.querySelector('[data-slot="sidebar"]')!;
  const rows = sidebar.querySelectorAll('[data-slot="sidebar-menu-button"], [data-slot="dropdown-menu-trigger"]');
  expect(rows).toHaveLength({ loading: 2, visitor: 3, pending: 3, candidate: 9, recruiter: 4 }[mode]);
  for (const row of rows) expect(row).toHaveClass(
    "group-data-[collapsible=icon]:size-10!",
    "group-data-[collapsible=icon]:mx-auto",
    "group-data-[collapsible=icon]:justify-center",
    "group-data-[collapsible=icon]:gap-0",
    "group-data-[collapsible=icon]:p-0!",
    "group-data-[collapsible=icon]:rounded-lg",
    "focus-visible:ring-3",
  );
  const brand = within(sidebar as HTMLElement).getByRole("link", { name: "PeopleFlow" });
  expect(brand.querySelector('[data-brand="wordmark"]')).toHaveAttribute("aria-hidden", "true");
  expect(brand.querySelector('[data-brand="mark"]')).toHaveAttribute("aria-hidden", "false");
  if (mode === "loading") expect(sidebar.querySelector('[data-slot="sidebar-footer"] [data-slot="skeleton"]')).toHaveClass("size-10", "mx-auto");
});
it("vacancy header provides a breadcrumb without owning a second h1", () => {
  render(<CandidateShell><CandidateHeader title="Backend Go" parent={{ label: "Vacantes", href: "/vacantes" }} heading={false} /><h1>Backend Go</h1></CandidateShell>);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  const header = document.querySelector("header")!;
  const breadcrumb = within(header).getByRole("navigation", { name: "Ruta de navegación" });
  expect(within(breadcrumb).getByRole("link", { name: "Vacantes" })).toHaveAttribute("href", "/vacantes");
  expect(within(breadcrumb).getByText("Backend Go")).toHaveAttribute("aria-current", "page");
});
it("on phones the vacancy breadcrumb collapses to a back link to its parent", () => {
  render(<CandidateShell><CandidateHeader title="Detalle de la vacante" parent={{ label: "Vacantes", href: "/vacantes" }} heading={false} /></CandidateShell>);
  const breadcrumb = within(document.querySelector("header")!).getByRole("navigation", { name: "Ruta de navegación" });
  const back = within(breadcrumb).getByRole("link", { name: "Vacantes" });
  expect(back.querySelector("svg")).toHaveClass("sm:hidden");
  // The current crumb stays announced but leaves the narrow header to the back link.
  expect(within(breadcrumb).getByText("Detalle de la vacante")).toHaveClass("max-sm:sr-only");
});
it("recruiter detail replaces the apply link with the candidate-only note and panel link", () => {
  role("recruiter"); render(<JobDetailView job={vacancyDetail} />);
  expect(screen.queryByRole("link", { name: "Postularme" })).toBeNull();
  expect(screen.getByText("Las postulaciones son para cuentas de candidato")).toBeVisible();
  expect(screen.getByRole("link", { name: "Ir a mi panel" })).toHaveAttribute("href", "/empresa/dashboard");
});
it.each(["loading", "unauthenticated"] as const)("%s detail retains the server apply link", status => {
  viewer.status = status; render(<JobDetailView job={vacancyDetail} />);
  expect(screen.getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${vacancyDetail.id}/postular`);
});
