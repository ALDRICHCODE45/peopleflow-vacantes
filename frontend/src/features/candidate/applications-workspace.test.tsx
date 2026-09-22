import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_APPLICATIONS } from "./prototype-portfolio";
import { ApplicationsWorkspace } from "./applications-workspace";

// Source as text, so the coupling, token and side-effect contracts stay asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/features/candidate/applications-workspace.tsx"), "utf8");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
const FILTER_LABELS = ["Todas", "Enviadas", "En revisión", "Contratadas", "Rechazadas"] as const;
const SEARCH_LABEL = "Buscar por puesto o empresa";
const rowIds = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-pf-application-row]")).map((node) => node.getAttribute("data-pf-application-row"));
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const renderWorkspace = (applications = CANDIDATE_APPLICATIONS) => render(<ApplicationsWorkspace applications={applications} />);
const filter = (name: RegExp) => screen.getByRole("button", { name });
const row = (container: HTMLElement, application: (typeof CANDIDATE_APPLICATIONS)[number]) => container.querySelector(`[data-pf-application-row="${application.id}"]`) as HTMLElement;
afterEach(cleanup);

describe("applications workspace filters", () => {
  it("exposes one labelled search input and the exact counted, ordered, pressed status filters", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(screen.getByLabelText(SEARCH_LABEL)).toHaveAttribute("data-pf-applications-search");
    const buttons = Array.from(container.querySelectorAll("[data-pf-applications-filter]")) as HTMLElement[];
    expect(buttons.map((button) => button.getAttribute("data-pf-applications-filter"))).toEqual(["all", "submitted", "in_review", "hired", "rejected"]);
    expect(buttons.map((button) => button.textContent)).toEqual(["Todas4", "Enviadas1", "En revisión1", "Contratadas1", "Rechazadas1"]);
    expect(buttons.map((button) => button.textContent?.replace(/\d+$/u, ""))).toEqual([...FILTER_LABELS]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false"]);
  });

  it("filters by status and composes it with the diacritic- and case-insensitive search", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(filter(/^Enviadas/));
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[0].id]);
    expect(filter(/^Enviadas/)).toHaveAttribute("aria-pressed", "true");
    await user.click(filter(/^Todas/));
    const search = screen.getByLabelText(SEARCH_LABEL);
    await user.type(search, "ACME");
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[0].id, CANDIDATE_APPLICATIONS[1].id]);
    await user.click(filter(/^Enviadas/));
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[0].id]);
    await user.clear(search);
    await user.type(search, "disenadora");
    expect(rowIds(container)).toEqual([]);
    await user.click(filter(/^Todas/));
    expect(rowIds(container)).toEqual([CANDIDATE_APPLICATIONS[3].id]);
  });

  it("orders by updatedAt desc without mutating the props array", () => {
    const reversed = [...CANDIDATE_APPLICATIONS].reverse();
    const before = JSON.stringify(reversed);
    const { container } = renderWorkspace(reversed);
    expect(rowIds(container)).toEqual(CANDIDATE_APPLICATIONS.map((application) => application.id));
    expect(JSON.stringify(reversed)).toBe(before);
    expect(reversed[0].jobTitle).toBe("Diseñadora UX");
  });
});

describe("applications workspace results", () => {
  it("keeps the live result count in agreement with the rendered rows", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const status = container.querySelector("[data-pf-applications-count]") as HTMLElement;
    expect([status.getAttribute("role"), status.getAttribute("aria-live")]).toEqual(["status", "polite"]);
    expect(status).toHaveTextContent("Mostrando 4 postulaciones");
    await user.type(screen.getByLabelText(SEARCH_LABEL), "acme");
    expect(status).toHaveTextContent("Mostrando 2 postulaciones");
    expect(rowIds(container)).toHaveLength(2);
    await user.click(filter(/^Rechazadas/));
    expect(status).toHaveTextContent("Mostrando 0 postulaciones");
    expect(rowIds(container)).toHaveLength(0);
  });

  it("renders complete candidate facts, bounded cover-letter copy and the supplemental status dot", () => {
    const { container } = renderWorkspace();
    const submitted = row(container, CANDIDATE_APPLICATIONS[0]);
    for (const value of ["Desarrolladora Go", "Acme", "Enviada", "LinkedIn", "5 de marzo de 2026", "Sin carta de presentación"]) expect(submitted).toHaveTextContent(value);
    const dot = submitted.querySelector("span[aria-hidden='true']") as HTMLElement;
    expect([dot.className.includes("rounded-full"), dot.className.includes("bg-chart-3")]).toEqual([true, true]);
    expect(submitted.querySelectorAll("time")).toHaveLength(2);
    expect(submitted.querySelector("time")).toHaveAttribute("datetime", CANDIDATE_APPLICATIONS[0].createdAt);
    const review = row(container, CANDIDATE_APPLICATIONS[1]);
    for (const value of ["Ingeniera Frontend", "Acme", "En revisión", "Referida", "20 de febrero de 2026", "1 de marzo de 2026", "Me entusiasma construir interfaces accesibles para productos financieros."]) expect(review).toHaveTextContent(value);
    expect(review.querySelector(".line-clamp-3")).not.toBeNull();
  });

  it("renders exactly one canonical link for linked rows and the historical note otherwise", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll("a")).toHaveLength(2);
    for (const application of CANDIDATE_APPLICATIONS) {
      const item = row(container, application);
      expect([item.closest("a"), item.querySelectorAll("button").length]).toEqual([null, 0]);
      const links = item.querySelectorAll("a");
      if (application.publicJobHref === null) {
        expect(links).toHaveLength(0);
        expect(item).toHaveTextContent("Vacante histórica sin enlace");
      } else {
        expect(links).toHaveLength(1);
        expect(links[0]).toHaveAttribute("href", application.publicJobHref);
        expect(links[0]).toHaveTextContent("Ver vacante");
        expect(links[0]).toHaveAttribute("aria-label", `Ver vacante de ${application.jobTitle} en ${application.companyName}`);
      }
    }
    expect(container.querySelector("a[href='#']")).toBeNull();
  });

  it("uses natural Spanish singular and plural for the live count", () => {
    renderWorkspace([CANDIDATE_APPLICATIONS[0]]);
    expect(screen.getByRole("status")).toHaveTextContent("Mostrando 1 postulación");
    cleanup();
    renderWorkspace();
    expect(screen.getByRole("status")).toHaveTextContent("Mostrando 4 postulaciones");
    expect(screen.getByRole("status")).not.toHaveTextContent("1 postulaciones");
  });
});

describe("applications workspace empty states", () => {
  it("recovers a filtered zero state through a named message and Limpiar filtros", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText(SEARCH_LABEL), "zzz");
    const empty = container.querySelector("[data-pf-applications-empty]") as HTMLElement;
    expect(empty).toHaveTextContent("Sin resultados");
    expect(empty).toHaveTextContent("zzz");
    const clear = screen.getByRole("button", { name: "Limpiar filtros" });
    expect([clear.className.includes("min-h-10"), clear.className.includes("focus-visible:ring-3")]).toEqual([true, true]);
    await user.click(clear);
    expect(rowIds(container)).toHaveLength(4);
    expect(screen.getByLabelText(SEARCH_LABEL)).toHaveValue("");
    expect(filter(/^Todas/)).toHaveAttribute("aria-pressed", "true");
  });

  it("names the active status when a filter alone yields no results", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace([CANDIDATE_APPLICATIONS[0]]);
    await user.click(filter(/^Contratadas/));
    expect(container.querySelector("[data-pf-applications-empty]")).toHaveTextContent("No hay postulaciones con el estado Contratada");
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument();
  });

  it("stays honest and offers no clear action when there are truly no applications", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace([]);
    expect(container.querySelector("[data-pf-applications-empty]")).toHaveTextContent("Todavía no tienes postulaciones");
    await user.type(screen.getByLabelText(SEARCH_LABEL), "algo");
    await user.click(filter(/^Enviadas/));
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
    expect(rowIds(container)).toEqual([]);
  });
});

describe("applications workspace contract", () => {
  it("discloses the local read-only scope and renders no mutation affordance", () => {
    const { container } = renderWorkspace();
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-pf-applications-disclosure");
    for (const claim of ["solo lectura", "retirar postulaciones", "cambiar su estado", "reclutadores", "no se guarda nada"]) expect(note).toHaveTextContent(claim);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(5);
    expect(container).not.toHaveTextContent(/Retirar|Cancelar postulación/);
  });

  it("keeps targets at least 40px with visible focus, token-only paint and responsive fact grids", () => {
    const { container } = renderWorkspace();
    expect(screen.getByLabelText(SEARCH_LABEL).className).toContain("h-10");
    for (const node of container.querySelectorAll("[data-pf-applications-filter], a")) {
      const classes = node.getAttribute("class") ?? "";
      expect(classes.includes("min-h-10") && classes.includes("focus-visible:ring-3"), node.textContent ?? "").toBe(true);
    }
    const facts = container.querySelector("dl") as HTMLElement;
    expect([facts.className.includes("grid-cols-1"), facts.className.includes("sm:grid-cols-2"), facts.className.includes("lg:grid-cols-4")]).toEqual([true, true, true]);
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(SOURCE).not.toMatch(/w-\[\d+px\]/u);
  });

  it("stays a local client surface over props with no fixture, network, router or side effect", () => {
    expect(SOURCE).toMatch(/^\s*["']use client["']/mu);
    const modules = [...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
    expect(modules).toEqual(["./portfolio-model", "next/link", "react"]);
    for (const forbidden of ["prototype-", "CANDIDATE_APPLICATIONS", "@/features/", "@/components/", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.", "useRouter", "next/navigation", "onDrag", "draggable", "<form", "useEffect", "setTimeout", "setInterval", "Math.random", "Date.now", "window.", "formatDistance", "reverse()", "shift()"]) {
      expect(SOURCE, `applications-workspace.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
  });
});
