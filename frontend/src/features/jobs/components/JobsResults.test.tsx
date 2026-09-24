import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ACME_WIRE_JOBS } from "../prototype-jobs";
import type { JobItem } from "../types";
import type { JobsQuery } from "../url";
import { JobsResults } from "./JobsResults";

type ResultsProps = Parameters<typeof JobsResults>[0];

/** Comments never render, so they are stripped before scanning shipping source. */
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\n]*/gu, " ");
/**
 * Implementation-status display copy banned from shipping source. Each entry is
 * prose, never a technical identifier such as `PrototypeJobView` or
 * `data-detail-card="prototype"`, and comments are stripped before the scan.
 */
const STATUS_DISPLAY_COPY = /demostraci[óo]n|fictici[ao]s?|solo demostraci|marcada solo|no se guard[óo]|no se guarda|no se copi[óo]|no se comparti[óo]|no se envi[oó]|no se env[ií]a|no disponible|no implementado|\bPrototipo\b|\bprototipo\b/iu;
/** Rendered implementation-status vocabulary banned from any visible text. */
const RENDERED_STATUS_COPY = /\b(?:demo|mock|prototip\w*|fictici\w*|prueba|test|local|no disponible|no implementado|no se guarda|no se env[ií]a|no se copi[oó]|no se comparti[oó])\b/iu;

const [FRONTEND_JOB, GO_JOB] = ACME_WIRE_JOBS;
const ACME_COMPANY_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const COMPANY_HREF = `/empresas/${ACME_COMPANY_ID}`;

/** A wire-only vacancy whose company name matches the prototype profile but
 * whose id is unknown: the enrichment gate alone must keep it plain text. */
const WIRE_ONLY_ACME_JOB: JobItem = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90",
  title: "Analista de Datos",
  description: "Descripción de la vacante tal como llega del cable.",
  work_mode: "onsite",
  employment_type: "part_time",
  seniority: "mid",
  salary_currency: "MXN",
  location: "Guadalajara, Jalisco",
  salary_min: 20000,
  salary_max: 25000,
  published_at: "2026-01-05T09:30:00Z",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d91", name: "Acme" },
};

const FILTERED_QUERY: JobsQuery = { q: "frontend", currency: "MXN" };
/** Decoded fixture cursor: the link must transport it untouched. */
const CURSOR = "opaque a+b/c=";
const CURSOR_HREF =
  "/vacantes?q=frontend&currency=MXN&cursor=opaque+a%2Bb%2Fc%3D";

/** The successful list envelope the guarded read resolves to. */
const listOf = (items: JobItem[]): ResultsProps["result"] => ({
  ok: true,
  data: { items },
});

afterEach(() => cleanup());

/** Every anchor target rendered inside `root`, in document order. */
const hrefsOf = (root: Element) => Array.from(root.querySelectorAll("a")).map((node) => node.getAttribute("href"));

describe("JobsResults board composition", () => {
  it("renders a known prototype vacancy through the enriched card and links its canonical profile", () => {
    const { container } = render(
      <JobsResults result={listOf([FRONTEND_JOB])} query={{}} />,
    );

    // The whole row is delegated to the reusable card: exactly two element
    // children, one H3, canonical detail link, and an opted-in company link.
    const item = container.querySelector("li");
    expect(item?.children).toHaveLength(2);
    // The replaced private row's tile is gone: the card's one aria-hidden span
    // is its monogram decoration, and the company name itself stays link text.
    const monogram = item?.querySelectorAll("span[aria-hidden='true']");
    expect([monogram?.length, monogram?.[0].textContent]).toEqual([1, "Ac"]);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: FRONTEND_JOB.title }),
    ).toHaveAttribute("href", `/vacantes/${FRONTEND_JOB.id}`);
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute(
      "href",
      COMPANY_HREF,
    );

    const text = container.textContent ?? "";
    for (const value of [
      "Ingeniería",
      FRONTEND_JOB.description,
      "Habilidades",
      "Beneficios",
      "React",
      "Seguro de salud",
    ]) {
      expect(text).toContain(value);
    }
    expect(text).not.toMatch(/aplicar|postular|guardar|verificad|popular|\/ mes/u);
  });

  it("keeps an unknown Acme vacancy wire-only, plain, and unlinked", () => {
    const { container } = render(
      <JobsResults result={listOf([WIRE_ONLY_ACME_JOB])} query={{}} />,
    );

    expect(screen.getByText("Acme").closest("a")).toBeNull();
    expect(screen.queryByRole("link", { name: "Acme" })).toBeNull();
    // The card owns exactly its two canonical detail affordances — the H3 title
    // link and the rail CTA — and still links no company at all.
    expect(hrefsOf(container)).toEqual([`/vacantes/${WIRE_ONLY_ACME_JOB.id}`, `/vacantes/${WIRE_ONLY_ACME_JOB.id}`]);

    const text = container.textContent ?? "";
    for (const value of [
      "Presencial",
      "Medio tiempo",
      "Guadalajara, Jalisco",
      "Publicada: 5 de enero de 2026",
    ]) {
      expect(text).toContain(value);
    }
    expect(text).toMatch(/MXN 20,000 . MXN 25,000/u);
    expect(text).not.toContain("Prototipo");
  });

  it("links a company only when both the enrichment and the profile resolve", () => {
    // The known id still earns the prototype extras, but an unresolvable
    // company keeps the company line as plain text.
    const unknownCompany = {
      ...FRONTEND_JOB,
      company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99", name: "Otra Empresa" },
    };
    const { container } = render(
      <JobsResults result={listOf([unknownCompany])} query={{}} />,
    );

    expect(container.textContent).toContain("Ingeniería");
    expect([container.querySelectorAll("[role='note']").length, RENDERED_STATUS_COPY.test(container.textContent ?? "")]).toEqual([0, false]);
    expect(screen.queryByRole("link", { name: "Otra Empresa" })).toBeNull();
    expect(screen.getByText("Otra Empresa").closest("a")).toBeNull();
    // Both anchors stay canonical detail links: no company anchor exists.
    expect(hrefsOf(container)).toEqual([`/vacantes/${FRONTEND_JOB.id}`, `/vacantes/${FRONTEND_JOB.id}`]);
  });

  it("preserves wire order, per-item structure, and only the enriched company links", () => {
    const { container } = render(
      <JobsResults
        result={listOf([GO_JOB, WIRE_ONLY_ACME_JOB, FRONTEND_JOB])}
        query={{}}
      />,
    );

    const items = Array.from(container.querySelectorAll("li"));
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.children).toHaveLength(2);
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent),
    ).toEqual([GO_JOB.title, WIRE_ONLY_ACME_JOB.title, FRONTEND_JOB.title]);
    expect(
      Array.from(container.querySelectorAll("li h3 a")).map((node) =>
        node.getAttribute("href"),
      ),
    ).toEqual([
      `/vacantes/${GO_JOB.id}`,
      `/vacantes/${WIRE_ONLY_ACME_JOB.id}`,
      `/vacantes/${FRONTEND_JOB.id}`,
    ]);
    // The exact id/name resolution links both enriched Acme roles and leaves
    // the unknown-id Acme role as plain text.
    expect(screen.getAllByRole("link", { name: "Acme" })).toHaveLength(2);
  });
});

describe("JobsResults preserved result states", () => {
  it("keeps the retryable error alert and its exact current-query retry link", () => {
    render(
      <JobsResults
        result={{ ok: false, error: { kind: "status", retryable: true, status: 503 } }}
        query={FILTERED_QUERY}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las vacantes",
    );
    const retry = screen.getByRole("link", { name: "Intentar de nuevo" });
    expect(retry).toHaveAttribute("href", "/vacantes?q=frontend&currency=MXN");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("keeps the empty state, its unfiltered reset, and no list markup", () => {
    render(
      <JobsResults result={listOf([])} query={{ q: "react", currency: "USD" }} />,
    );

    expect(screen.getByText("No hay vacantes")).toBeVisible();
    expect(screen.getByRole("link", { name: "Quitar filtros" })).toHaveAttribute(
      "href",
      "/vacantes",
    );
    expect(
      screen.queryByRole("list", { name: "Listado de vacantes" }),
    ).toBeNull();
  });

  it("preserves every filter and the opaque cursor on the next link only", () => {
    const { rerender } = render(
      <JobsResults
        result={{ ok: true, data: { items: [FRONTEND_JOB], next_cursor: CURSOR } }}
        query={FILTERED_QUERY}
      />,
    );

    const next = screen.getByRole("link", { name: "Ver más vacantes" });
    expect(next).toHaveAttribute("href", CURSOR_HREF);
    expect(next).toHaveAttribute("data-jobs-next-link", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    rerender(<JobsResults result={listOf([FRONTEND_JOB])} query={FILTERED_QUERY} />);
    expect(screen.queryByRole("link", { name: "Ver más vacantes" })).toBeNull();
  });
});

describe("JobsResults server boundary", () => {
  const source = readFileSync(
    join(process.cwd(), "src/features/jobs/components/JobsResults.tsx"),
    "utf8",
  );

  it("stays a server component that delegates rows and never fetches or holds state", () => {
    expect(source).not.toMatch(/^\s*["']use client["']/mu);
    expect(source).not.toMatch(/\bfetch\s*\(|react-query|useState|useEffect/u);
    for (const specifier of [
      "./VacancyCard",
      "../enrich",
      "../../company-profile/model",
      "../../company-profile/prototype-companies",
    ]) {
      expect(source).toContain(specifier);
    }
    // The replaced private row and its monogram/icon tables are gone.
    expect(source).not.toMatch(/companyInitials|WORK_MODE_ICONS|function JobRow/u);
  });

  it("ships no implementation-status display copy outside comments or identifiers", () => {
    expect(withoutComments(source)).not.toMatch(STATUS_DISPLAY_COPY);
  });
});
