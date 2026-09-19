import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { enrichJob } from "../enrich";
import type { JobPayFrequency, PrototypeJobEnrichment, PrototypeJobView } from "../enrich";
import { ACME_WIRE_JOBS } from "../prototype-jobs";
import type { JobItem } from "../types";
import { PROTOTYPE_DISCLOSURE } from "./prototype-ui";
import { VacancyCard } from "./VacancyCard";

/** A wire vacancy the prototype never enriches: the plain board-card fallback. */
const WIRE_ONLY_JOB: JobItem = { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90", title: "Analista de Datos", description: "Descripción de la vacante tal como llega del cable.", work_mode: "onsite", employment_type: "part_time", seniority: "mid", salary_currency: "MXN", location: "Guadalajara, Jalisco", salary_min: 20000, salary_max: 25000, published_at: "2026-01-05T09:30:00Z", company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d91", name: "Otra Empresa" } };
const [FRONTEND_JOB, GO_JOB] = ACME_WIRE_JOBS;
const wireOnly = enrichJob(WIRE_ONLY_JOB);
const enriched = enrichJob(FRONTEND_JOB);
const goJob = enrichJob(GO_JOB);
const COMPANY_HREF = "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
/** Every literal paint a token-only card must never carry in a class list. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
/** Claim-like or action-like copy this prototype must never state as real. */
const FORBIDDEN_COPY = /aplicar|postular|popular|recomendad|candidat|guardar|\d+\s*%|monthly|yearly|hourly/u;
/** One enriched card rendered from `description`, plus its description paragraph. */
const descriptionNode = (description: string) => {
  const { container } = render(<VacancyCard job={{ ...enriched, description }} />);
  return { container, paragraph: container.querySelector("p.line-clamp-2") };
};
/** The card source, so the component boundary checks read the shipped bytes. */
const source = readFileSync(join(process.cwd(), "src/features/jobs/components/VacancyCard.tsx"), "utf8");
/** A salaryless wire vacancy carrying a chosen prototype pay frequency. */
const payRailJob = (payFrequency: JobPayFrequency): PrototypeJobView => ({
  ...enrichJob({ ...WIRE_ONLY_JOB, salary_min: undefined, salary_max: undefined }),
  prototype: { ...(enriched.prototype as PrototypeJobEnrichment), payFrequency, featured: false, verifiedByPeopleFlow: false },
});
/** Every class list rendered inside `root`, to prove the card stays token-only. */
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");

afterEach(() => cleanup());

describe("VacancyCard layout and affordances", () => {
  it("lays one list item out as a two-child content grid with an integrated salary rail", () => {
    const { container } = render(<VacancyCard job={enriched} />);
    const card = container.querySelector("li");
    expect(card?.children).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(card?.className).toMatch(/(?:^|\s)grid(?:\s|$)/u);
    expect(card?.className).toMatch(/(?:^|\s)md:grid-cols-/u);
    const [content, rail] = Array.from(card?.children ?? []) as HTMLElement[];
    expect([content.className.includes("flex-col"), rail.className.includes("flex-col")]).toEqual([true, true]);
    expect(rail.className).toMatch(/border-t/u);
    expect(rail.className).toMatch(/md:border-l/u);
    expect(rail.textContent).toContain("SALARIO MENSUAL");
  });

  it("renders the company monogram, the canonical H3 title link, and a disabled bookmark affordance", () => {
    const { container } = render(<VacancyCard job={enriched} />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect([headings.length, headings[0].textContent]).toEqual([1, FRONTEND_JOB.title]);
    const titleLink = screen.getByRole("link", { name: FRONTEND_JOB.title });
    expect([titleLink.getAttribute("href"), titleLink.className]).toEqual([`/vacantes/${FRONTEND_JOB.id}`, expect.stringMatching(/focus-visible:outline/u)]);
    expect(container.querySelector("span[aria-hidden='true']")?.textContent).toBe("Ac");
    const bookmark = container.querySelector("button");
    expect([bookmark?.getAttribute("type"), bookmark?.disabled, bookmark?.getAttribute("aria-label"), bookmark?.getAttribute("title")]).toEqual(["button", true, "Guardar vacante (solo demostración)", "Guardar vacante (solo demostración)"]);
    expect([bookmark?.className.includes("size-10"), bookmark?.getAttributeNames().some((name) => name.startsWith("on"))]).toEqual([true, false]);
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("keeps the canonical CTA beside the opt-in company link on exact public hrefs", () => {
    const { container, rerender } = render(<VacancyCard job={enriched} />);
    expect(screen.getByText("Acme").closest("a")).toBeNull();
    const cta = screen.getByRole("link", { name: "Ver vacante" });
    expect([cta.getAttribute("href"), cta.className.includes("min-h-10")]).toEqual([`/vacantes/${FRONTEND_JOB.id}`, true]);
    expect(container.querySelectorAll("a")).toHaveLength(2);
    rerender(<VacancyCard job={enriched} companyHref={COMPANY_HREF} />);
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute("href", COMPANY_HREF);
    expect(container.querySelectorAll("a")).toHaveLength(3);
  });
});

describe("VacancyCard wire fallback state", () => {
  it("keeps a wire-only vacancy free of prototype metrics, rail extras, save control, and disclosure", () => {
    const { container } = render(<VacancyCard job={wireOnly} />);
    const text = container.textContent ?? "";
    for (const value of ["Presencial", "Medio tiempo", "Otra Empresa", "Guadalajara, Jalisco", "Publicada: 5 de enero de 2026", WIRE_ONLY_JOB.description, "SALARIO"]) expect(text).toContain(value);
    expect(text).toMatch(/MXN 20,000 . MXN 25,000/u);
    for (const absent of ["Destacada", "postulante", "Responde en", "Verificada por PeopleFlow", "Prototipo", "Habilidades", "Beneficios", "Ingeniería", "SALARIO MENSUAL", PROTOTYPE_DISCLOSURE]) expect(text).not.toContain(absent);
    expect([container.querySelectorAll("button").length, screen.queryByRole("note"), screen.queryByRole("button", { name: /guardar/iu })]).toEqual([0, null, null]);
    expect(FORBIDDEN_COPY.test(text)).toBe(false);
    expect(container.querySelector("li")?.children).toHaveLength(2);
  });
});

describe("VacancyCard enriched state", () => {
  it("renders the prototype badge, metrics, department, skills, benefits, and rail claims", () => {
    const { container } = render(<ul><VacancyCard job={enriched} /><VacancyCard job={goJob} /></ul>);
    const [featured, plain] = Array.from(container.querySelectorAll("li"));
    const text = container.textContent ?? "";
    for (const value of ["Destacada", "Hace 2 h", "24 postulantes", "Hace 5 h", "41 postulantes", "Ingeniería", "Monterrey, Nuevo León", "Plataforma", "Habilidades", "Beneficios", "SALARIO MENSUAL", "Responde en ~3 días", "Verificada por PeopleFlow", PROTOTYPE_DISCLOSURE, ...(enriched.prototype?.skills ?? []), ...(enriched.prototype?.benefits ?? [])]) expect(text).toContain(value);
    expect([featured.textContent?.includes("Destacada"), plain.textContent?.includes("Destacada")]).toEqual([true, false]);
    const skills = featured.querySelector("dl");
    expect([skills?.className.includes("sm:grid-cols-2"), Array.from(skills?.querySelectorAll("dt") ?? []).map((term) => term.textContent)]).toEqual([true, ["Habilidades", "Beneficios"]]);
    expect(screen.getAllByRole("note")).toHaveLength(2);
    expect(FORBIDDEN_COPY.test(text)).toBe(false);
  });

  it("labels the rail by the prototype pay frequency and falls back to Salario a convenir", () => {
    const { container } = render(<ul>{(["monthly", "yearly", "hourly"] as const).map((frequency) => <VacancyCard key={frequency} job={payRailJob(frequency)} />)}</ul>);
    const text = container.textContent ?? "";
    for (const label of ["SALARIO MENSUAL", "SALARIO ANUAL", "SALARIO POR HORA", "Salario a convenir", PROTOTYPE_DISCLOSURE]) expect(text).toContain(label);
    for (const absent of ["Verificada por PeopleFlow", "Destacada"]) expect(text).not.toContain(absent);
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("keeps the whole normalized description in one text node, clipped only by line-clamp-2", () => {
    const long = `Primer párrafo.\n\n${"palabra ".repeat(45)}final. 🙂 <b>Negrita</b> <script>alert('xss')</script>`;
    const { container, paragraph } = descriptionNode(long);
    const text = paragraph?.textContent ?? "";
    expect(text).toBe(`Primer párrafo. ${"palabra ".repeat(45)}final. 🙂 <b>Negrita</b> <script>alert('xss')</script>`);
    expect([Array.from(text).length > 220, /\s{2,}|\n/u.test(text), text.endsWith("…"), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)]).toEqual([true, false, false, false]);
    expect([paragraph?.childNodes.length, paragraph?.firstChild?.nodeType]).toEqual([1, Node.TEXT_NODE]);
    expect([paragraph?.className.includes("line-clamp-2"), container.querySelectorAll("b, script, img, iframe").length]).toEqual([true, 0]);
    const token = descriptionNode("c".repeat(200)).paragraph?.textContent ?? "";
    expect([token, Array.from(token).length]).toEqual(["c".repeat(200), 200]);
    expect(source).not.toMatch(/\.slice\(|\.substr|substring\(|EXCERPT_MAX_LENGTH/u);
  });

  it("renders accented and astral text verbatim while keeping wire markup inert", () => {
    const { container } = render(<VacancyCard job={{ ...wireOnly, title: "Ingeniera de Datos 🚀", location: "Bogotá, Colombia", description: "<b>Negrita</b> y ñ" }} />);
    const text = container.textContent ?? "";
    for (const value of ["Ingeniera de Datos 🚀", "Bogotá, Colombia", "<b>Negrita</b> y ñ"]) expect(text).toContain(value);
    expect(container.querySelectorAll("b, script, img, iframe")).toHaveLength(0);
    const { container: go } = render(<VacancyCard job={goJob} />);
    expect(go.textContent).toContain("<script>alert('xss')</script>");
  });

  it("never renders the raw pay enum, requirements, or a closing date", () => {
    const { container } = render(<ul><VacancyCard job={enriched} /><VacancyCard job={goJob} /></ul>);
    const text = container.textContent ?? "";
    for (const hidden of ["2026-03-31", "monthly", "SALARIO POR", ...(enriched.prototype?.requiredRequirements ?? []), ...(enriched.prototype?.preferredRequirements ?? [])]) expect(text).not.toContain(hidden);
  });
});

describe("VacancyCard responsive, motion, and token contract", () => {
  it("keeps the card overflow-safe with token surfaces, restrained hover, and reduced-motion guards", () => {
    const { container } = render(<VacancyCard job={enriched} companyHref={COMPANY_HREF} />);
    const classes = container.querySelector("li")?.className ?? "";
    for (const utility of ["rounded-2xl", "border-border", "bg-card/60", "p-4", "md:p-6", "[overflow-wrap:anywhere]", "group", "hover:border-primary/40", "focus-within:border-primary/40", "hover:shadow-lg", "duration-200", "motion-safe:hover:-translate-y-0.5", "motion-reduce:transition-none", "motion-reduce:translate-none"]) expect(classes).toContain(utility);
    const rail = classesOf(container.querySelector("li") as Element);
    expect([rail.includes("md:border-l"), rail.includes("md:pl-6"), container.querySelectorAll("li > *")]).toEqual([true, true, expect.objectContaining({ length: 2 })]);
    expect([container.querySelectorAll("[style]").length, RAW_COLOR.test(classesOf(container))]).toEqual([0, false]);
  });
});

describe("VacancyCard server boundary", () => {
  it("stays a presentational server component with no inline style, paint, request, or state", () => {
    expect(source).not.toMatch(/^\s*["']use client["']/mu);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|useState|useEffect|useRef/u);
    expect(source).not.toMatch(/onClick|onChange|style=\{\{|dangerouslySetInnerHTML/u);
    expect(source).not.toMatch(RAW_COLOR);
    for (const specifier of ["./prototype-ui", "../formatters", "../enrich"]) expect(source).toContain(specifier);
  });
});
