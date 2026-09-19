import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { formatClosingDate, formatSalary, payFrequencyLabel, workModeLabel } from "../formatters";
import { PROTOTYPE_COMPANY_ID } from "../../company-profile/model";
import { ACME_PROTOTYPE_PROFILE } from "../../company-profile/prototype-companies";
import { enrichJob } from "../enrich";
import type { PrototypeJobView } from "../enrich";
import type { JobItem } from "../types";
import { JobDetailView } from "./JobDetailView";

const baseJob: JobItem = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  title: "Ingeniera Frontend",
  description: "Construye experiencias accesibles.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
};

// Markup-like middle segments must render as text, never be interpreted.
const UNSAFE_DESCRIPTION =
  "Primer párrafo de la vacante.\n\n<script>alert('xss')</script>\n\nSegundo párrafo con <img src=x onerror=alert(1)> incrustado.\n\nLínea uno\nLínea dos.";

describe("JobDetailView validated rendering", () => {
  const fullJob: JobItem = {
    ...baseJob,
    location: "Monterrey, Nuevo León",
    salary_min: 30000,
    salary_max: 45000,
    published_at: "2026-02-14T09:30:00Z",
  };

  it("renders one article with the title, company, full metadata, and back navigation", () => {
    const { salary_min: min, salary_max: max, salary_currency: cur } = fullJob;
    const salary = formatSalary({ min, max, currency: cur });
    render(<JobDetailView job={fullJob} />);
    const view = within(screen.getByRole("article"));
    const h1 = view.getAllByRole("heading", { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveAccessibleName(fullJob.title);
    expect(view.getByText(fullJob.company.name)).toBeVisible();
    expect(view.getByText(fullJob.location!)).toBeVisible();
    expect(view.getByText(salary!)).toBeVisible();
    expect(view.getByText(/publicada/i)).toBeVisible();
    for (const label of ["Remoto", "Tiempo completo", "Senior"]) {
      expect(view.getByText(label, { exact: true })).toBeVisible();
    }
    const back = view.getByRole("link", { name: /volver a vacantes/i });
    expect(back).toHaveAttribute("href", "/vacantes");
  });

  it("renders the description as escaped plain text with paragraphs and line breaks", () => {
    const job = { ...baseJob, description: UNSAFE_DESCRIPTION };
    const { container } = render(<JobDetailView job={job} />);
    const article = container.querySelector("article");
    expect(article).not.toBeNull();
    expect(article!.querySelector("script")).toBeNull();
    expect(article!.querySelector("img")).toBeNull();
    expect(screen.getByText("<script>alert('xss')</script>")).toBeVisible();
    // Blank lines split paragraphs; a single break stays inside one paragraph.
    const paragraphs = screen.getAllByRole("paragraph");
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[3].textContent).toBe("Línea uno\nLínea dos.");
  });

  it("omits absent optional metadata instead of showing placeholders", () => {
    render(<JobDetailView job={baseJob} />);
    const article = screen.getByRole("article");
    expect(article).toBeVisible();
    expect(screen.queryByText(/publicada/i)).toBeNull();
    expect(screen.queryByText(/MXN|USD/)).toBeNull();
    expect(screen.queryByText(/Desde|Hasta/)).toBeNull();
    expect(article.textContent).not.toContain("undefined");
  });
});

describe("JobDetailView prototype role block", () => {
  const enrichedJob = enrichJob(baseJob);

  it("keeps one H1, the four description paragraphs, and no image or script", () => {
    const job: PrototypeJobView = { ...enrichedJob, description: UNSAFE_DESCRIPTION };
    const { container } = render(<JobDetailView job={job} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("paragraph")).toHaveLength(4);
    expect(container.querySelectorAll("article img, article script")).toHaveLength(0);
    // The header badge stays the article's first list item and the prototype
    // block adds no inline style.
    expect(container.querySelector("article li")?.textContent).toBe(
      workModeLabel(enrichedJob.work_mode),
    );
    expect(container.querySelectorAll("article [style]")).toHaveLength(0);
  });

  it("renders prototype list text as escaped plain text and adds no paragraph", () => {
    const unsafeList = "<img src=x onerror=alert(1)>";
    const job: PrototypeJobView = {
      ...enrichedJob,
      prototype: {
        ...enrichedJob.prototype!,
        requiredRequirements: [unsafeList],
        preferredRequirements: ["<b>Next.js</b>"],
        skills: ["<script>alert('skill')</script>"],
        benefits: ["<em>Seguro de salud</em>"],
      },
    };
    const { container } = render(<JobDetailView job={job} />);
    expect(screen.getByText(unsafeList)).toBeVisible();
    expect(screen.getByText("<script>alert('skill')</script>")).toBeVisible();
    expect(screen.getByText("<b>Next.js</b>")).toBeVisible();
    expect(
      container.querySelectorAll("article img, article script, article b, article em"),
    ).toHaveLength(0);
    // Only the wire description is a paragraph: the prototype block is not.
    expect(screen.getAllByRole("paragraph")).toHaveLength(1);
  });

  it("renders the disclosed prototype role content from the enrichment only", () => {
    const prototype = enrichedJob.prototype!;
    const job: PrototypeJobView = { ...enrichedJob, salary_min: 30000, salary_max: 45000 };
    render(<JobDetailView job={job} />);
    expect(
      screen.getByRole("heading", { level: 2, name: `Prototipo · ${prototype.department}` }),
    ).toBeVisible();
    expect(screen.getByText("Frecuencia de pago")).toBeVisible();
    expect(screen.getByText(payFrequencyLabel(prototype.payFrequency))).toBeVisible();
    expect(screen.getByText(formatClosingDate(prototype.closingDate!))).toBeVisible();
    for (const label of ["Indispensables", "Deseables"]) {
      expect(screen.getByRole("heading", { level: 4, name: label })).toBeVisible();
    }
    for (const label of ["Requisitos", "Habilidades y beneficios"]) {
      expect(screen.getByRole("heading", { level: 3, name: label })).toBeVisible();
    }
    for (const text of [
      ...prototype.requiredRequirements,
      ...prototype.preferredRequirements,
      ...prototype.skills,
    ]) {
      expect(screen.getByText(text)).toBeVisible();
    }
    expect(screen.getByText(prototype.benefits.join(" · "))).toBeVisible();
    // The wire salary keeps its own header slot; the pay frequency is disclosed
    // separately and never fuses into the salary string.
    const salary = formatSalary({ min: 30000, max: 45000, currency: "MXN" })!;
    expect(screen.getByText(salary)).toBeVisible();
    expect(salary).not.toContain(payFrequencyLabel(prototype.payFrequency));
  });

  it("links to the canonical company profile and discloses the prototype profile", () => {
    render(<JobDetailView job={enrichedJob} />);
    const link = screen.getByRole("link", { name: `Conoce a ${ACME_PROTOTYPE_PROFILE.name}` });
    expect(link).toHaveAttribute("href", `/empresas/${PROTOTYPE_COMPANY_ID}`);
    expect(screen.getByText(ACME_PROTOTYPE_PROFILE.disclosure.label)).toBeVisible();
    expect(screen.getByText(ACME_PROTOTYPE_PROFILE.disclosure.statement)).toBeVisible();
    // A bare company name stays the header text: the profile link never claims it.
    const company = screen.getByText(baseJob.company.name);
    expect(company).toBeVisible();
    expect(company.closest("a")).toBeNull();
  });

  it("omits the closing date when the enrichment declares none", () => {
    const job: PrototypeJobView = {
      ...enrichedJob,
      prototype: { ...enrichedJob.prototype!, closingDate: undefined },
    };
    render(<JobDetailView job={job} />);
    expect(screen.getByText("Frecuencia de pago")).toBeVisible();
    expect(screen.queryByText("Cierre de postulaciones")).toBeNull();
  });

  it("nests the prototype block headings inside the page hierarchy", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const block = container.querySelector("section[aria-labelledby='prototipo-vacante']");
    const headings = [...(block?.querySelectorAll("h1, h2, h3, h4, h5, h6") ?? [])];
    expect(headings.map((heading) => [heading.tagName, heading.textContent])).toEqual([
      ["H2", `Prototipo · ${enrichedJob.prototype!.department}`],
      ["H3", "Requisitos"],
      ["H4", "Indispensables"],
      ["H4", "Deseables"],
      ["H3", "Habilidades y beneficios"],
    ]);
  });

  it("keeps heading levels in document order with no skipped level", () => {
    const { container } = render(<JobDetailView job={enrichedJob} />);
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) =>
      Number(heading.tagName.slice(1)),
    );
    expect(levels).toEqual([1, 2, 2, 3, 4, 4, 3]);
    levels.forEach((level, index) => {
      if (index > 0) expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
    });
  });

  it("omits the prototype block entirely for a wire-only vacancy", () => {
    render(<JobDetailView job={baseJob} />);
    expect(screen.queryByRole("heading", { name: /prototipo/i })).toBeNull();
    expect(screen.queryByText(/frecuencia de pago/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /conoce a/i })).toBeNull();
  });

  it("keeps the prototype block without a company link when no profile matches", () => {
    const job: PrototypeJobView = {
      ...enrichedJob,
      company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99", name: "Otra Empresa" },
    };
    render(<JobDetailView job={job} />);
    expect(screen.getByRole("heading", { level: 2, name: /prototipo/i })).toBeVisible();
    expect(screen.queryByRole("link", { name: /conoce a/i })).toBeNull();
    expect(screen.queryByText(ACME_PROTOTYPE_PROFILE.disclosure.statement)).toBeNull();
  });
});
