import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { enrichJob } from "../enrich";
import { ACME_WIRE_JOBS } from "../prototype-jobs";
import type { JobItem } from "../types";
import { VacancyCard } from "./VacancyCard";

/** A wire vacancy the prototype never enriches: the plain board-card fallback. */
const WIRE_ONLY_JOB: JobItem = { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90", title: "Analista de Datos", description: "Descripción de la vacante tal como llega del cable.", work_mode: "onsite", employment_type: "part_time", seniority: "mid", salary_currency: "MXN", location: "Guadalajara, Jalisco", salary_min: 20000, salary_max: 25000, published_at: "2026-01-05T09:30:00Z", company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d91", name: "Otra Empresa" } };
const [FRONTEND_JOB, GO_JOB] = ACME_WIRE_JOBS;
const wireOnly = enrichJob(WIRE_ONLY_JOB);
const enriched = enrichJob(FRONTEND_JOB);
/** The excerpt paragraph a card renders for `description`; empty when nothing clips. */
const excerptFor = (description: string) => {
  const { container } = render(<VacancyCard job={{ ...enriched, description }} />);
  return Array.from(container.querySelectorAll("p")).find((node) => node.textContent?.endsWith("…"))?.textContent ?? "";
};
/** Claim-like or action-like copy this prototype must never render. */
const FORBIDDEN_COPY = /aplicar|postular|guardar|verificad|popular|recomendad|candidat|\d+\s*%|monthly|yearly|hourly/u;
const COMPANY_HREF = "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";

afterEach(() => cleanup());

describe("VacancyCard structure and links", () => {
  it("renders a list item with exactly two element children and one H3 title link", () => {
    const { container } = render(<VacancyCard job={enriched} />);
    const card = container.querySelector("li");
    expect(card?.children).toHaveLength(2);
    expect(Array.from(card?.children ?? []).every((child) => child instanceof HTMLElement)).toBe(true);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect([headings.length, headings[0].textContent]).toEqual([1, FRONTEND_JOB.title]);
    const titleLink = screen.getByRole("link", { name: FRONTEND_JOB.title });
    expect([titleLink.getAttribute("href"), titleLink.className]).toEqual([`/vacantes/${FRONTEND_JOB.id}`, expect.stringMatching(/focus-visible:outline/u)]);
  });

  it("renders the company as plain text and as a link only when a caller passes one", () => {
    const { container, rerender } = render(<VacancyCard job={enriched} />);
    expect(screen.getByText("Acme").closest("a")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(1);
    rerender(<VacancyCard job={enriched} companyHref={COMPANY_HREF} />);
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute("href", COMPANY_HREF);
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });
});

describe("VacancyCard wire fallback state", () => {
  it("renders the wire facts with the existing formatter labels and no prototype block", () => {
    const { container } = render(<VacancyCard job={wireOnly} />);
    const text = container.textContent ?? "";
    for (const value of ["Presencial", "Medio tiempo", "Otra Empresa", "Publicada: 5 de enero de 2026"]) expect(text).toContain(value);
    expect(text).toMatch(/MXN 20,000 . MXN 25,000/u);
    expect(text).not.toContain(WIRE_ONLY_JOB.description);
    expect(text).not.toMatch(/Prototipo|Habilidades|Beneficios/u);
    expect(container.querySelector("li")?.children).toHaveLength(2);
  });
});

describe("VacancyCard enriched state", () => {
  it("adds the prototype marker, department, excerpt, skills, and benefits on wrapping chips", () => {
    const { container } = render(<VacancyCard job={enriched} companyHref={COMPANY_HREF} />);
    const text = container.textContent ?? "";
    for (const value of ["Prototipo", "Ingeniería", FRONTEND_JOB.description, "Habilidades", "Beneficios"]) expect(text).toContain(value);
    for (const value of [...(enriched.prototype?.skills ?? []), ...(enriched.prototype?.benefits ?? [])]) expect(text).toContain(value);
    expect(container.querySelector("li")?.className).toContain("[overflow-wrap:anywhere]");
    const chips = Array.from(container.querySelectorAll(".bg-muted"));
    expect(chips.length).toBeGreaterThanOrEqual(5);
    for (const item of chips) expect(item.parentElement?.className).toContain("flex-wrap");
  });

  it("normalizes and clips the wire description on whole code points, words, and tokens", () => {
    const long = `Primer párrafo de la vacante.\n\n${"palabra ".repeat(40)}final.`;
    const normalized = excerptFor(long);
    expect(normalized).toMatch(/^Primer párrafo de la vacante\. palabra/u);
    expect(normalized).not.toMatch(/\s{2,}|\n/u);
    expect(normalized).not.toContain(long.trim());
    expect([normalized.length > 100, normalized.length <= 200]).toEqual([true, true]);
    expect(excerptFor("a".repeat(150) + " " + "b".repeat(50))).toBe("a".repeat(150) + "…");
    const emoji = excerptFor("d".repeat(159) + "🙂".repeat(5));
    expect([emoji.includes("🙂"), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(emoji)]).toEqual([true, false]);
    expect(excerptFor("c".repeat(200))).toBe("c".repeat(160) + "…");
    expect(Array.from(excerptFor("c".repeat(200)))).toHaveLength(161);
  });

  it("never renders pay frequency, requirements, closing date, or claim copy", () => {
    const { container } = render(<ul><VacancyCard job={enriched} /><VacancyCard job={enrichJob(GO_JOB)} /></ul>);
    const text = container.textContent ?? "";
    expect(FORBIDDEN_COPY.test(text)).toBe(false);
    // The wire description of the Go fixture carries markup as text: it must be
    // shown escaped and never become a live element of the page.
    expect(container.querySelectorAll("script, img, iframe")).toHaveLength(0);
    expect(text).toContain("<script>alert('xss')</script>");
    for (const hidden of ["2026-03-31", "monthly", ...(enriched.prototype?.requiredRequirements ?? []), ...(enriched.prototype?.preferredRequirements ?? [])]) expect(text).not.toContain(hidden);
  });
});
