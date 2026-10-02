import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ACME_PROTOTYPE_JOBS, ACME_WIRE_JOBS } from "@/features/jobs/prototype-jobs";
import { SavedVacanciesWorkspace } from "./saved-vacancies-workspace";

// Source and rendered copy as text, so the read-only contract, the token paint
// and the visible Spanish stay asserted here instead of only in the browser.
const SOURCE = readFileSync(join(process.cwd(), "src/features/candidate/saved-vacancies-workspace.tsx"), "utf8");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
/** Strips technical comments so the copy audits inspect only product strings. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\n]*/gu, " ");
const IMPLEMENTATION_STATUS_COPY = /\b(?:demo|mock|prototip\w*|fictici\w*|prueba|test|local|no disponible|no implementado|no se guarda)\b/iu;
/**
 * Neutral Mexican Spanish only: the rioplatense voseo conjugations and pronouns
 * the product never ships. `\b` keeps ordinary words such as "vosotros"-free
 * product strings intact.
 */
const VOSEO = /\b(?:vos|sos|tenés|querés|podés|sabés|andá|mirá|elegí|guardá|usá|agregá|revisá)\b/iu;
/** Removal, re-save or sync vocabulary a saved list could fake; "guardadas" stays allowed. */
const FAKE_PERSISTENCE_COPY = /guardar|quitar|eliminar|borrar|descartar|deshacer|sincroniz|se guardó/iu;

const HEADING = "Vacantes guardadas";
const GO_FACTS = [
  ["Modalidad", "Híbrido"],
  ["Tipo de empleo", "Por contrato"],
  ["Nivel", "Líder"],
  ["Ubicación", "Monterrey, Nuevo León"],
  ["Salario", "MXN 30,000 – MXN 45,000"],
] as const;
const FRONTEND_FACTS = [
  ["Modalidad", "Remoto"],
  ["Tipo de empleo", "Tiempo completo"],
  ["Nivel", "Senior"],
] as const;

const renderWorkspace = (savedVacancies = ACME_PROTOTYPE_JOBS) => render(<SavedVacanciesWorkspace savedVacancies={savedVacancies} />);
const cards = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-pf-saved-vacancy]")) as HTMLElement[];
const card = (container: HTMLElement, id: string) => container.querySelector(`[data-pf-saved-vacancy="${id}"]`) as HTMLElement;
const slot = (root: Element, name: string) => root.querySelector(`[data-slot="${name}"]`) as HTMLElement;
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const factsOf = (root: Element) => {
  const metadata = root.querySelector("dl[data-pf-saved-vacancy-metadata]") as HTMLElement;
  return {
    labels: Array.from(metadata.querySelectorAll("dt")).map((term) => term.textContent as string),
    values: Array.from(metadata.querySelectorAll("dd")).map((value) => value.textContent as string),
    terms: Array.from(metadata.querySelectorAll("dt")),
  };
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("saved vacancies fixtures", () => {
  it("uses the two canonical Acme prototype vacancies as the committed input", () => {
    expect(ACME_PROTOTYPE_JOBS.map((job) => job.title)).toEqual(["Ingeniera Frontend", "Desarrolladora Go"]);
    expect(ACME_PROTOTYPE_JOBS.every((job) => Object.isFrozen(job))).toBe(true);
  });
});

describe("saved vacancies introduction", () => {
  it("leads with the saved-vacancies heading, one context line and the candidate measure with a single padding owner", () => {
    const { container } = renderWorkspace();
    const intro = container.querySelector("[data-pf-saved-vacancies-intro]") as HTMLElement;
    expect(intro.querySelector("h2")).toHaveTextContent(HEADING);
    expect(intro.querySelectorAll("h2")).toHaveLength(1);
    const context = intro.querySelector("p") as HTMLElement;
    expect(context).not.toBeNull();
    expect(context.textContent?.trim().length).toBeGreaterThan(0);
    expect(context.className).toContain("text-muted-foreground");
    const root = container.querySelector("[data-pf-saved-vacancies-workspace]") as HTMLElement;
    const tokens = root.className.split(/\s+/u);
    expect(["mx-auto", "w-full", "max-w-screen-2xl"].filter((token) => !tokens.includes(token))).toEqual([]);
    expect(["px-4", "py-4", "md:py-6", "lg:px-6"].filter((token) => !tokens.includes(token))).toEqual([]);
    const owners = Array.from(container.querySelectorAll("[class]")).filter((node) => {
      const value = (node.getAttribute("class") ?? "").split(/\s+/u);
      return value.includes("px-4") && value.includes("lg:px-6");
    });
    expect(owners).toEqual([root]);
    expect(intro).not.toBe(root);
  });
});

describe("saved vacancies grid", () => {
  it("renders one rich vertical Card per fixture, in fixture order, inside a one/two column grid", () => {
    const { container } = renderWorkspace();
    const rendered = cards(container);
    expect(rendered.map((node) => node.getAttribute("data-pf-saved-vacancy"))).toEqual(ACME_PROTOTYPE_JOBS.map((job) => job.id));
    expect(rendered).toHaveLength(ACME_PROTOTYPE_JOBS.length);
    const grid = container.querySelector("[data-pf-saved-vacancies-grid]") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.className.split(/\s+/u)).toEqual(expect.arrayContaining(["grid", "grid-cols-1", "lg:grid-cols-2"]));
    expect(rendered.every((node) => node.parentElement === grid)).toBe(true);
    for (const node of rendered) {
      expect(node).toHaveAttribute("data-slot", "card");
      expect(node.className).toContain("flex-col");
      expect(node.className).toContain("h-full");
      for (const part of ["card-header", "card-title", "card-content", "card-footer"]) expect(slot(node, part), part).not.toBeNull();
      expect(slot(node, "card-header").className).toContain("border-b");
      expect(slot(node, "card-footer").className).toContain("border-t");
      expect(node.className + " " + classesOf(node)).not.toMatch(/min-h-screen|h-screen|min-h-dvh|h-dvh|min-h-svh|h-svh/u);
    }
  });

  it("keeps the identity medallion, the company and a real h3 title inside the card header", () => {
    const { container } = renderWorkspace();
    for (const job of ACME_PROTOTYPE_JOBS) {
      const node = card(container, job.id);
      const header = slot(node, "card-header");
      const identity = header.querySelector("[data-pf-saved-vacancy-identity]") as HTMLElement;
      expect(identity).not.toBeNull();
      expect(identity).toHaveAttribute("aria-hidden", "true");
      expect(identity.className).toContain("rounded-full");
      expect(identity.className).toContain("bg-primary/10");
      expect(identity.className).toContain("text-primary");
      expect(identity.querySelector("svg")).not.toBeNull();
      const heading = header.querySelector("[data-slot='card-title'] h3") as HTMLElement;
      expect(heading).not.toBeNull();
      expect(heading).toHaveTextContent(job.title);
      expect(header).toHaveTextContent(job.company.name);
      // The title stays plain text: the card's only link is the footer action.
      expect(heading.closest("a")).toBeNull();
    }
  });

  it("labels every fact with a functional icon and renders the values through the canonical job formatters", () => {
    const { container } = renderWorkspace();
    for (const [id, expected] of [[ACME_PROTOTYPE_JOBS[1].id, GO_FACTS], [ACME_PROTOTYPE_JOBS[0].id, FRONTEND_FACTS]] as const) {
      const facts = factsOf(card(container, id));
      expect(facts.labels).toEqual(expected.map(([label]) => label));
      expect(facts.values).toEqual(expected.map(([, value]) => value));
      for (const term of facts.terms) {
        const icon = term.querySelector("svg") as SVGElement;
        expect(icon).not.toBeNull();
        expect(icon).toHaveAttribute("aria-hidden", "true");
        expect(icon.className.baseVal ?? icon.getAttribute("class")).toContain("size-3.5");
      }
    }
  });

  it("omits the salary and location facts a vacancy does not carry instead of inventing them", () => {
    const { container } = renderWorkspace();
    const facts = factsOf(card(container, ACME_PROTOTYPE_JOBS[0].id));
    expect(facts.labels).not.toContain("Salario");
    expect(facts.labels).not.toContain("Ubicación");
    expect(card(container, ACME_PROTOTYPE_JOBS[0].id)).not.toHaveTextContent("Salario a convenir");
    expect(card(container, ACME_PROTOTYPE_JOBS[0].id)).not.toHaveTextContent("Monterrey");
  });

  it("renders the received order instead of sorting or filtering the list", () => {
    const reversed = [...ACME_PROTOTYPE_JOBS].reverse();
    const { container } = renderWorkspace(reversed);
    expect(cards(container).map((node) => node.getAttribute("data-pf-saved-vacancy"))).toEqual(reversed.map((job) => job.id));
    expect(reversed.map((job) => job.id)).not.toEqual(ACME_PROTOTYPE_JOBS.map((job) => job.id));
  });

  it("reads only wire facts, so an un-enriched vacancy renders the same saved card", () => {
    const { container } = renderWorkspace(ACME_WIRE_JOBS);
    expect(cards(container)).toHaveLength(ACME_WIRE_JOBS.length);
    for (const job of ACME_WIRE_JOBS) {
      const node = card(container, job.id);
      expect(node.querySelector("dl[data-pf-saved-vacancy-metadata]")).not.toBeNull();
      expect(node.querySelectorAll("a")).toHaveLength(1);
    }
    // The enriched and the wire-only fixture render exactly the same facts.
    expect(factsOf(card(container, ACME_PROTOTYPE_JOBS[1].id)).values).toEqual(GO_FACTS.map(([, value]) => value));
    expect(factsOf(card(container, ACME_PROTOTYPE_JOBS[0].id)).values).toEqual(FRONTEND_FACTS.map(([, value]) => value));
  });
});

describe("saved vacancies footer action", () => {
  it("keeps exactly one canonical Ver vacante link per card in the footer and nothing else", () => {
    const { container } = renderWorkspace();
    const links = Array.from(container.querySelectorAll("a")) as HTMLElement[];
    expect(links).toHaveLength(ACME_PROTOTYPE_JOBS.length);
    for (const job of ACME_PROTOTYPE_JOBS) {
      const node = card(container, job.id);
      const footer = slot(node, "card-footer");
      const cardLinks = Array.from(node.querySelectorAll("a")) as HTMLElement[];
      expect(cardLinks).toHaveLength(1);
      const link = cardLinks[0];
      expect(footer.contains(link)).toBe(true);
      expect(link).toHaveAttribute("href", `/vacantes/${job.id}`);
      expect(link).toHaveAttribute("data-slot", "button");
      expect(link).toHaveAttribute("aria-label", `Ver vacante de ${job.title} en ${job.company.name}`);
      expect(link).toHaveTextContent("Ver vacante");
      expect(link.className).toContain("min-h-10");
      expect(link.querySelector("svg")).not.toBeNull();
    }
    expect(container.querySelector("a[href='#']")).toBeNull();
    expect(container.querySelector("[data-pf-saved-vacancy] a[target]")).toBeNull();
  });
});

describe("saved vacancies empty state", () => {
  it("renders the installed Empty hierarchy for an empty list with honest copy and no card or link", () => {
    const { container } = renderWorkspace([]);
    const marker = container.querySelector("[data-pf-saved-vacancies-empty]") as HTMLElement;
    expect(marker).not.toBeNull();
    const empty = (marker.matches("[data-slot='empty']") ? marker : marker.querySelector("[data-slot='empty']")) as HTMLElement;
    expect(empty).not.toBeNull();
    for (const part of ["empty-header", "empty-title", "empty-description"]) expect(slot(empty, part), part).not.toBeNull();
    expect(empty).toHaveTextContent("Todavía no tienes vacantes guardadas");
    expect(empty).toHaveTextContent("Cuando guardes una vacante, va a aparecer en este listado.");
    expect(empty.className).toMatch(/(?:^|\s)(?:p|py|px)-\d/u);
    expect(empty.className).not.toContain("p-12");
    expect(cards(container)).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelector("[data-pf-saved-vacancies-grid]")).toBeNull();
    // The empty list carries no filter vocabulary and no recovery control, because
    // this surface has no filter and nothing to recover.
    expect(empty).not.toHaveTextContent("Sin resultados");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("saved vacancies read-only contract", () => {
  it("renders no control, no form and no fake saved-persistence affordance", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("form, input, textarea, select")).toHaveLength(0);
    for (const role of ["switch", "checkbox", "radio", "tab", "listbox", "menu"]) expect(screen.queryAllByRole(role)).toHaveLength(0);
    expect(FAKE_PERSISTENCE_COPY.test(container.textContent ?? "")).toBe(false);
    expect(container.querySelectorAll("[data-pf-saved-vacancies-empty]")).toHaveLength(0);
    expect(container.querySelector("[data-pf-saved-vacancies-disclosure]")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("keeps the fixture array, its order and its facts untouched", () => {
    const original = [...ACME_PROTOTYPE_JOBS];
    const before = JSON.stringify(original);
    const { container, unmount } = renderWorkspace(original);
    expect(cards(container).map((node) => node.getAttribute("data-pf-saved-vacancy"))).toEqual(original.map((job) => job.id));
    expect(JSON.stringify(original)).toBe(before);
    unmount();
    cleanup();
    // Re-rendering the same frozen fixture yields the same order and the same facts.
    const second = renderWorkspace(ACME_PROTOTYPE_JOBS);
    expect(cards(second.container).map((node) => node.getAttribute("data-pf-saved-vacancy"))).toEqual(original.map((job) => job.id));
    expect(factsOf(card(second.container, ACME_PROTOTYPE_JOBS[1].id)).values).toEqual(GO_FACTS.map(([, value]) => value));
  });

  it("stays a local props surface with only the approved modules, token paint and neutral Mexican copy", () => {
    const { container } = renderWorkspace();
    const modules = [...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
    expect(modules).toEqual([
      "@/components/dashboard-page-content",
      "@/components/ui/button",
      "@/components/ui/card",
      "@/components/ui/empty",
      "@/features/jobs/enrich",
      "@/features/jobs/formatters",
      "lucide-react",
      "next/link",
    ]);
    // No interactivity means no client boundary: the surface is a server component.
    expect(SOURCE).not.toMatch(/^\s*["']use client["']/mu);
    for (const forbidden of [
      "ACME_PROTOTYPE_JOBS", "prototype-jobs", "@/features/candidate/prototype", "portfolio-model",
      "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "document.cookie",
      "next/headers", "next/navigation", "useRouter", "useState", "useEffect", "onClick", "onChange",
      "<form", "<input", "<button", "window.", "Math.random", "Date.now", "setTimeout", "setInterval",
      "sort(", "filter(", "slice(", "reverse(", "shift(", "splice(",
    ]) {
      expect(SOURCE, `saved-vacancies-workspace.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(Array.from(container.querySelectorAll("[style]"))).toHaveLength(0);
    expect(SOURCE).not.toMatch(/style=\{\{/u);
    expect(IMPLEMENTATION_STATUS_COPY.test(stripComments(SOURCE))).toBe(false);
    expect(VOSEO.test(stripComments(SOURCE))).toBe(false);
    expect(VOSEO.test(container.textContent ?? "")).toBe(false);
    // The two formatters that carry the labels and the salary are the shipped ones.
    for (const formatter of ["employmentTypeLabel", "formatSalary", "seniorityLabel", "workModeLabel"]) expect(SOURCE).toContain(formatter);
  });
});
