import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { TEAM_MEMBER_ROLE_LABELS, TEAM_MEMBER_STATUS_LABELS } from "./model";
import type { TeamMember } from "./model";
import { NEXO_TEAM_MEMBERS } from "./prototype-team";
import { TeamWorkspace } from "./team-workspace";

const source = readFileSync(join(process.cwd(), "src/features/employer-team/team-workspace.tsx"), "utf8");
/** Every literal paint a token-only surface must never carry in a class list. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
/** Every class list rendered inside `root`, to prove the surface stays token-only. */
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const renderTeam = (members: readonly TeamMember[] = NEXO_TEAM_MEMBERS) => render(<TeamWorkspace members={members} />);
const metric = (root: HTMLElement, key: string) => root.querySelector(`[data-pf-team-metric="${key}"]`) as HTMLElement;
const rowIds = (root: Element) => Array.from(root.querySelectorAll("[data-pf-team-row]")).map((node) => node.getAttribute("data-pf-team-row"));
const rowOf = (root: HTMLElement, id: string) => root.querySelector(`[data-pf-team-row="${id}"]`) as HTMLElement;
const rowText = (root: HTMLElement, id: string) => rowOf(root, id).textContent ?? "";
const filterButton = (name: RegExp) => screen.getByRole("button", { name });
const searchInput = () => screen.getByLabelText("Buscar miembro");
afterEach(() => cleanup());

describe("TeamWorkspace summary metrics", () => {
  it("renders the four derived metrics over the exact six default members", () => {
    const { container } = renderTeam();
    expect(container.querySelectorAll("[data-pf-team-metric]")).toHaveLength(4);
    // Derived, not hardcoded: 6 members, 1 owner, 5 recruiters, 1 invited; every label agrees with its value.
    expect(["total", "owners", "recruiters", "invited"].map((key) => metric(container, key).textContent)).toEqual([
      "6Miembros", "1Propietario", "5Reclutadores", "1Invitación pendiente",
    ]);
    expect(rowIds(container)).toEqual(NEXO_TEAM_MEMBERS.map((member) => member.id));
  });
});

describe("TeamWorkspace search and status filters", () => {
  it("searches full name and email ignoring case and diacritics", async () => {
    const user = userEvent.setup();
    const { container } = renderTeam();
    expect(searchInput()).toHaveAttribute("data-pf-team-search");
    expect(searchInput()).toHaveAttribute("placeholder", "Buscar por nombre o correo…");
    await user.type(searchInput(), "LUCIA");
    expect(rowIds(container)).toEqual(["lucia-navarro"]);
    await user.clear(searchInput());
    await user.type(searchInput(), "peña");
    expect(rowIds(container)).toEqual(["andrea-pena"]);
    await user.clear(searchInput());
    await user.type(searchInput(), "CAMILA.DUARTE@");
    expect(rowIds(container)).toEqual(["camila-duarte"]);
  });

  it("counts each status filter, exposes its pressed state, and composes with the search", async () => {
    const user = userEvent.setup();
    const { container } = renderTeam();
    const filters = Array.from(container.querySelectorAll("[data-pf-team-filter]")) as HTMLElement[];
    expect(filters.map((filter) => filter.getAttribute("data-pf-team-filter"))).toEqual(["all", "active", "invited"]);
    expect(filters.map((filter) => filter.textContent)).toEqual(["Todas6", "Activas5", "Pendientes1"]);
    expect(filters.map((filter) => filter.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    await user.click(filterButton(/^Pendientes/));
    expect(rowIds(container)).toEqual(["lucia-navarro"]);
    expect(filterButton(/^Pendientes/)).toHaveAttribute("aria-pressed", "true");
    await user.click(filterButton(/^Activas/));
    expect(rowIds(container)).toHaveLength(5);
    await user.type(searchInput(), "valeria");
    expect(rowIds(container)).toEqual(["valeria-ortiz"]);
    await user.type(searchInput(), "lucia");
    expect(rowIds(container)).toEqual([]);
  });

  it("reports an honest visible result count with natural singular and plural", async () => {
    const user = userEvent.setup();
    const { container } = renderTeam();
    const count = () => (container.querySelector("[data-pf-team-count]") as HTMLElement).textContent;
    expect(count()).toBe("6 miembros");
    await user.click(filterButton(/^Pendientes/));
    expect(count()).toBe("1 miembro");
    expect(count()).not.toBe("1 miembros");
  });
});

describe("TeamWorkspace member rows", () => {
  it("states the complete role, status, and workload facts with natural plurals", () => {
    const { container } = renderTeam();
    expect(rowText(container, "tomas-rios")).toContain("Tomás Ríos");
    expect(rowText(container, "tomas-rios")).toContain("tomas.rios@nexolabs.mx");
    expect(rowText(container, "tomas-rios")).toContain(TEAM_MEMBER_ROLE_LABELS.owner);
    expect(rowText(container, "tomas-rios")).toContain(TEAM_MEMBER_STATUS_LABELS.active);
    expect(rowText(container, "tomas-rios")).toContain("Sin vacantes asignadas");
    expect(rowText(container, "valeria-ortiz")).toContain(TEAM_MEMBER_ROLE_LABELS.recruiter);
    expect(rowText(container, "valeria-ortiz")).toContain("2 vacantes · 10 candidatos en proceso");
    expect(rowText(container, "andrea-pena")).toContain("Sin vacantes asignadas");
    expect(rowText(container, "lucia-navarro")).toContain(TEAM_MEMBER_STATUS_LABELS.invited);
    expect(rowText(container, "lucia-navarro")).toContain("Sin vacantes asignadas");
    // Meaning lives in the text; the dot is decorative and hidden from assistive tech.
    expect(rowOf(container, "valeria-ortiz").querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(rowText(container, "valeria-ortiz")).not.toContain("1 vacantes");
  });

  it("agrees in number for a single vacancy and a single candidate", () => {
    const solo: readonly TeamMember[] = [
      { id: "solo-reclutador", fullName: "Solo Reclutador", email: "solo.reclutador@nexolabs.mx", role: "recruiter", status: "active", workload: { ownedVacancies: 1, inProcessCandidates: 1 } },
    ];
    const { container } = renderTeam(solo);
    const copy = rowText(container, "solo-reclutador");
    expect(rowIds(container)).toEqual(["solo-reclutador"]);
    expect(copy).toContain("1 vacante · 1 candidato en proceso");
    expect(copy).not.toContain("1 vacantes");
    expect(copy).not.toContain("1 candidatos");
    // Singular metric labels over the same one-member input; zero stays plural.
    expect(["total", "owners", "recruiters", "invited"].map((key) => metric(container, key).textContent)).toEqual(["1Miembro", "0Propietarios", "1Reclutador", "0Invitaciones pendientes"]);
  });

  it("never hides in-process candidates when a member owns no vacancies", () => {
    const idle: readonly TeamMember[] = [
      { id: "sin-vacantes", fullName: "Sin Vacantes", email: "sin.vacantes@nexolabs.mx", role: "recruiter", status: "active", workload: { ownedVacancies: 0, inProcessCandidates: 5 } },
    ];
    const barely: readonly TeamMember[] = [
      { id: "un-candidato", fullName: "Un Candidato", email: "un.candidato@nexolabs.mx", role: "recruiter", status: "active", workload: { ownedVacancies: 0, inProcessCandidates: 1 } },
    ];
    // Only a true 0/0 member loses the exact "Sin vacantes asignadas" copy; a nonzero count is always visible.
    expect(rowText(renderTeam(idle).container, "sin-vacantes")).toContain("Sin vacantes asignadas · 5 candidatos en proceso");
    expect(rowText(renderTeam(barely).container, "un-candidato")).toContain("Sin vacantes asignadas · 1 candidato en proceso");
  });

  it("renders one semantic non-interactive row per member in input order", () => {
    const { container } = renderTeam();
    const list = container.querySelector("[data-pf-team-list]") as HTMLElement;
    expect([list.tagName, list.querySelectorAll("li").length]).toEqual(["UL", 6]);
    const rows = Array.from(container.querySelectorAll("[data-pf-team-row]"));
    expect(rows.map((row) => row.getAttribute("data-pf-team-row"))).toEqual([...NEXO_TEAM_MEMBERS].map((member) => member.id));
    for (const row of rows) {
      expect([row.tagName, row.closest("a"), row.closest("button"), row.querySelectorAll("a, button, input, select, textarea, [tabindex]").length]).toEqual(["LI", null, null, 0]);
    }
  });
});

describe("TeamWorkspace empty states", () => {
  it("recovers from an empty result through a clear action that resets search and status", async () => {
    const user = userEvent.setup();
    const { container } = renderTeam();
    await user.type(searchInput(), "sin coincidencias");
    expect(rowIds(container)).toEqual([]);
    expect(container.querySelector("[data-pf-team-empty]")).not.toBeNull();
    const clear = screen.getByRole("button", { name: "Limpiar filtros" });
    expect(clear).toHaveAttribute("data-pf-team-clear");
    await user.click(clear);
    expect(rowIds(container)).toHaveLength(6);
    expect(searchInput()).toHaveValue("");
    expect(filterButton(/^Todas/)).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the true empty-team state without offering a misleading clear action", async () => {
    const user = userEvent.setup();
    const { container } = renderTeam([]);
    expect(container.querySelector("[data-pf-team-empty]")).toHaveTextContent("Todavía no hay miembros del equipo");
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
    expect(container.querySelectorAll("[data-pf-team-metric]")).toHaveLength(4);
    await user.type(searchInput(), "algo");
    await user.click(filterButton(/^Activas/));
    expect(container.querySelector("[data-pf-team-empty]")).toHaveTextContent("Todavía no hay miembros del equipo");
    expect(rowIds(container)).toEqual([]);
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
  });
});

describe("TeamWorkspace interaction and source contract", () => {
  it("keeps every interactive target at least 40px, focus-visible, and token-only", () => {
    const { container } = renderTeam();
    expect(searchInput().className).toContain("h-10");
    for (const filter of container.querySelectorAll("[data-pf-team-filter]")) {
      const classes = filter.getAttribute("class") ?? "";
      expect([classes.includes("min-h-10"), classes.includes("focus-visible:ring-3")]).toEqual([true, true]);
    }
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("keeps narrow fact labels accessible, the header decorative, and the count announceable", () => {
    const { container } = renderTeam();
    const row = container.querySelector("[data-pf-team-row]") as HTMLElement;
    const grid = row.className;
    expect([grid.includes("grid-cols-1"), /lg:grid-cols-\[/u.test(grid), grid.includes("min-w-0") || row.querySelectorAll(".min-w-0").length > 0]).toEqual([true, true, true]);
    const labels = Array.from(row.querySelectorAll("[class*='lg:sr-only']"));
    expect(labels.map((label) => label.textContent)).toEqual(["Rol", "Estado", "Carga"]);
    // The labels collapse visually at desktop but must stay in the accessibility tree.
    expect(labels.every((label) => label.getAttribute("aria-hidden") === null)).toBe(true);
    const header = container.querySelector("[data-pf-team-header]") as HTMLElement;
    expect([header.className.includes("lg:grid"), header.getAttribute("aria-hidden"), header.querySelectorAll("[class*='lg:sr-only']").length]).toEqual([true, "true", 0]);
    expect((container.querySelector("[data-pf-team-results]") as HTMLElement).className).toContain("overflow-hidden");
    const count = container.querySelector("[data-pf-team-count]") as HTMLElement;
    expect([count.getAttribute("role"), count.getAttribute("aria-live")]).toEqual(["status", "polite"]);
  });

  it("stays a read-only client surface that never imports the Nexo fixture", () => {
    expect(source).toMatch(/^\s*["']use client["']/mu);
    expect(source).toContain("./model");
    for (const primitive of ["@/components/ui/badge", "@/components/ui/avatar", "@/components/ui/input", "@/components/ui/button", "@/components/ui/empty"]) {
      expect(source, `team-workspace.tsx must reuse ${primitive}`).toContain(primitive);
    }
    for (const forbidden of ["./prototype-team", "NEXO_TEAM_MEMBERS", "features/employer-vacancies", "prototype-vacancies", "next/link", "href", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.clipboard", "useRouter", "next/navigation", "onDrag", "onDrop", "draggable", ".css"]) {
      expect(source, `team-workspace.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
  });
});
