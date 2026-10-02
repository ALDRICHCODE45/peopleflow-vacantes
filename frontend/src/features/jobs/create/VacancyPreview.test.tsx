import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { VacancyPreview } from "./VacancyPreview";
import type { VacancyPreviewValues } from "./VacancyPreview";
import { INITIAL_PROTOTYPE_VALUES, MAX_SKILLS, SKILLS } from "./form/prototype-model";
import type { VacancyPrototypeValues } from "./form/prototype-model";

const previewSource = readFileSync(
  join(process.cwd(), "src", "features", "jobs", "create", "VacancyPreview.tsx"),
  "utf8",
);
const dossierPath = join(
  process.cwd(),
  "src",
  "features",
  "jobs",
  "create",
  "form",
  "prototype-dossier.tsx",
);
// An absent module must fail the structural assertions loudly without stopping
// the behavior tests in this file from running.
const dossierSource = existsSync(dossierPath) ? readFileSync(dossierPath, "utf8") : "";

afterEach(() => cleanup());

/** A brand-new draft, before the employer types anything. */
const emptyDraft: VacancyPreviewValues = {
  title: "",
  description: "",
  location: "",
  workMode: "",
  employmentType: "",
  seniority: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "MXN",
};

const filledDraft: VacancyPreviewValues = {
  ...emptyDraft,
  title: "Backend Developer (Senior)",
  description: "Liderá el diseño y la evolución de nuestros servicios core.",
  location: "Monterrey, NL",
  workMode: "remote",
  employmentType: "full_time",
  seniority: "lead",
  salaryMin: "25000",
  salaryMax: "40000",
};

/** Fully populated local-only state, as the enriched sections would produce. */
const enrichedPrototype: VacancyPrototypeValues = {
  ...INITIAL_PROTOTYPE_VALUES,
  department: "Ingeniería",
  // The screen can never hold more than the catalog limit, so ten is the maximum.
  skills: SKILLS.slice(0, MAX_SKILLS),
  languages: [
    { id: "language-1", language: "Inglés", level: "B2" },
    { id: "language-2", language: "Portugués", level: "" },
  ],
  benefits: ["health_insurance", "annual_bonus"],
  payFrequency: "monthly",
  requiredRequirements:
    "**Fuerte** experiencia con [React](https://empresa.example/vacante)",
  preferredRequirements: "- PostgreSQL\n- Docker",
  closingDate: "2026-12-31",
  screeningQuestions: [
    { id: "question-1", prompt: "¿Cuántos años de experiencia tenés?" },
    { id: "question-2", prompt: "¿Trabajaste en equipos distribuidos?" },
    { id: "question-3", prompt: "¿Tenés disponibilidad para viajar?" },
  ],
};

describe("VacancyPreview", () => {
  it("renders an explicit draft card with useful placeholders instead of invented data", () => {
    render(<VacancyPreview {...emptyDraft} />);

    expect(screen.getByText("Borrador")).toBeVisible();
    expect(screen.getByText(/vista previa de borrador/i)).toBeVisible();
    expect(screen.getByText("Título del puesto")).toBeVisible();
    expect(screen.getByText("Tu empresa")).toBeVisible();
    expect(screen.getByText("Modalidad sin definir")).toBeVisible();
    expect(screen.getByText("Jornada sin definir")).toBeVisible();
    expect(screen.getByText("Seniority sin definir")).toBeVisible();
    expect(
      screen.getByText("Todavía no escribiste una descripción."),
    ).toBeVisible();
    expect(screen.getByText("Salario a convenir")).toBeVisible();
  });

  it("renders the current values with fixed Spanish enum labels", () => {
    render(<VacancyPreview {...filledDraft} />);

    expect(screen.getByText("Backend Developer (Senior)")).toBeVisible();
    expect(screen.getByText("Tu empresa · Monterrey, NL")).toBeVisible();
    expect(screen.getByText("Remoto")).toBeVisible();
    expect(screen.getByText("Tiempo completo")).toBeVisible();
    expect(screen.getByText("Líder")).toBeVisible();
    expect(
      screen.getByText("Liderá el diseño y la evolución de nuestros servicios core."),
    ).toBeVisible();
  });

  it("formats the salary range exactly like the public vacancy card", () => {
    const { rerender } = render(<VacancyPreview {...filledDraft} />);
    // The shared feature formatter owns the wire-currency rendering, so the
    // preview shows the same string the public vacancy page shows.
    expect(screen.getByText("MXN 25,000 – MXN 40,000")).toBeVisible();

    rerender(<VacancyPreview {...filledDraft} salaryMax="" />);
    expect(screen.getByText("Desde MXN 25,000")).toBeVisible();

    rerender(
      <VacancyPreview
        {...filledDraft}
        salaryMin=""
        salaryCurrency="USD"
      />,
    );
    expect(screen.getByText("Hasta USD 40,000")).toBeVisible();
  });

  it("ignores salary input the contract cannot accept instead of inventing an amount", () => {
    const { rerender } = render(
      <VacancyPreview {...filledDraft} salaryMin="25,000" salaryMax="" />,
    );
    expect(screen.getByText("Salario a convenir")).toBeVisible();

    rerender(<VacancyPreview {...filledDraft} salaryMin="" salaryMax="" />);
    expect(screen.getByText("Salario a convenir")).toBeVisible();

    rerender(
      <VacancyPreview
        {...filledDraft}
        salaryMin="   "
        salaryCurrency="USD"
      />,
    );
    expect(screen.getByText("Hasta USD 40,000")).toBeVisible();
  });

  it("never renders a reversed salary range instead of inventing an order", () => {
    const { rerender } = render(
      <VacancyPreview {...filledDraft} salaryMin="40000" salaryMax="25000" />,
    );

    expect(screen.getByText("Salario a convenir")).toBeVisible();
    expect(screen.queryByText(/MXN 40,000 – MXN 25,000/u)).toBeNull();

    // Equal bounds still render; only a strictly reversed pair falls back.
    rerender(
      <VacancyPreview {...filledDraft} salaryMin="25000" salaryMax="25000" />,
    );
    expect(screen.getByText("MXN 25,000 – MXN 25,000")).toBeVisible();
  });

  it("never claims the vacancy is published and exposes no unsupported field or action", () => {
    const { container } = render(<VacancyPreview {...filledDraft} />);
    const text = container.textContent ?? "";

    expect(text).toContain("todavía no está publicada");
    expect(text).not.toMatch(/ya está publicada|se publicó|publicada con éxito/i);
    // Exploratory surfaces stay out of the baseline dossier.
    expect(text).not.toMatch(/área|requisitos|stack|tecnolog|exploratori/i);
    expect(text).not.toMatch(/ARS|EUR/);
    expect(text).not.toMatch(/bolsa de trabajo|solo interna|autoguardado/i);
    // A preview is presentational: it owns no interactive control.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("VacancyPreview baseline without prototype state", () => {
  it("adds nothing when the exploratory state is absent", () => {
    const { container } = render(<VacancyPreview {...filledDraft} />);

    expect(screen.queryByText("Información complementaria")).toBeNull();
    expect(screen.queryByText("Prototipo")).toBeNull();
    // The salary line keeps its exact baseline reading.
    expect(
      screen.getByText("MXN 25,000 – MXN 40,000"),
    ).toBeVisible();
    expect(container.textContent).not.toMatch(/Mensual|Anual|Por hora/);
  });

  it("adds nothing when the exploratory state carries no content", () => {
    render(
      <VacancyPreview
        {...filledDraft}
        prototype={{ ...INITIAL_PROTOTYPE_VALUES }}
      />,
    );

    expect(screen.queryByText("Información complementaria")).toBeNull();
    expect(
      screen.getByText("MXN 25,000 – MXN 40,000"),
    ).toBeVisible();
  });

  it("never lets the rich prototype description trigger exploratory content", () => {
    render(
      <VacancyPreview
        {...filledDraft}
        prototype={{
          ...INITIAL_PROTOTYPE_VALUES,
          descriptionRich: "**Fuerte** experiencia con React",
        }}
      />,
    );

    expect(screen.queryByText("Información complementaria")).toBeNull();
    expect(screen.getByText("MXN 25,000 – MXN 40,000")).toBeVisible();
  });
});

describe("VacancyPreview exploratory dossier", () => {
  it("labels the dossier and renders every requested category", () => {
    render(<VacancyPreview {...filledDraft} prototype={enrichedPrototype} />);

    expect(screen.getByText("Información complementaria")).toBeVisible();
    expect(screen.queryByText("Prototipo")).toBeNull();

    // Department, pay frequency as its own dossier row, languages with CEFR,
    // benefits with their count, closing date in Spanish, screening count.
    expect(screen.getByText("Ingeniería")).toBeVisible();
    expect(screen.getByText("Frecuencia de pago")).toBeVisible();
    expect(screen.getByText("Mensual")).toBeVisible();
    // The salary line keeps its exact contract-backed reading.
    expect(screen.getByText("MXN 25,000 – MXN 40,000")).toBeVisible();
    expect(screen.getByText("Inglés · B2 · Portugués")).toBeVisible();
    expect(screen.getByText("Beneficios (2)")).toBeVisible();
    expect(screen.getByText("Seguro de salud · Bono anual")).toBeVisible();
    expect(screen.getByText("31 de diciembre de 2026")).toBeVisible();
    expect(screen.getByText("3 preguntas")).toBeVisible();
  });

  it("renders a formatted contract description as readable plain text only", () => {
    const { container } = render(
      <VacancyPreview
        {...filledDraft}
        description={
          "**Fuerte** experiencia con [React](https://empresa.example/vacante)\n\n_Equipos distribuidos_\n\n- PostgreSQL\n1. Docker"
        }
      />,
    );

    expect(
      screen.getByText(
        "Fuerte experiencia con React Equipos distribuidos PostgreSQL Docker",
      ),
    ).toBeVisible();

    // No formatting token, list marker, or link address survives into the card.
    const text = container.textContent ?? "";
    for (const leaked of [
      "**",
      "_",
      "](https://",
      "https://",
      "empresa.example",
      "- PostgreSQL",
      "1. Docker",
    ]) {
      expect(
        text,
        `the public preview must not leak the token ${leaked}`,
      ).not.toContain(leaked);
    }
    expect(text).toContain("todavía no está publicada");
  });

  it("keeps pay frequency inside the labelled exploratory block", () => {
    const { container } = render(
      <VacancyPreview
        {...filledDraft}
        prototype={{ ...INITIAL_PROTOTYPE_VALUES, payFrequency: "monthly" }}
      />,
    );

    // A frequency with no other complementary value still renders the block.
    expect(screen.getByText("Información complementaria")).toBeVisible();
    expect(screen.queryByText("Prototipo")).toBeNull();
    expect(screen.getByText("Frecuencia de pago")).toBeVisible();
    expect(screen.getByText("Mensual")).toBeVisible();
    // The salary display is preserved exactly.
    expect(screen.getByText("MXN 25,000 – MXN 40,000")).toBeVisible();
    expect(container.textContent).not.toContain(
      "MXN 25,000 – MXN 40,000 · Mensual",
    );
  });

  it("clamps the technology badges and reports the remainder", () => {
    render(<VacancyPreview {...filledDraft} prototype={enrichedPrototype} />);

    for (const skill of SKILLS.slice(0, 6)) {
      expect(screen.getByText(skill)).toBeVisible();
    }
    // Exactly six badges plus one remainder counter for the four hidden skills.
    expect(screen.getByText("+4")).toBeVisible();
    for (const hidden of SKILLS.slice(6)) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
  });

  it("strips formatting tokens and link addresses from the summaries", () => {
    const { container } = render(
      <VacancyPreview {...filledDraft} prototype={enrichedPrototype} />,
    );

    expect(screen.getByText("Fuerte experiencia con React")).toBeVisible();
    expect(screen.getByText("PostgreSQL Docker")).toBeVisible();

    const text = container.textContent ?? "";
    expect(text).not.toContain("**");
    expect(text).not.toContain("](");
    expect(text).not.toContain("empresa.example");
    expect(text).not.toContain("<");
  });

  it("keeps the dossier honest and presentational", () => {
    const { container } = render(
      <VacancyPreview {...filledDraft} prototype={enrichedPrototype} />,
    );
    const text = container.textContent ?? "";

    // Product copy only: no implementation-status label survives in the rail.
    expect(text).not.toMatch(/prototipo|exploratori/i);
    expect(text).not.toMatch(/ya está publicada|se publicó|publicada con éxito/i);
    expect(text).not.toMatch(/guardado|persistid|se guardó/i);
    // Still a preview: no control, no link, and no raw markup path.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("neutralizes malformed formatting markers in the public description", () => {
    const { container } = render(
      <VacancyPreview
        {...filledDraft}
        description={"**Fuerte sin cerrar y [texto](sin-cierre"}
      />,
    );

    expect(screen.getByText("Fuerte sin cerrar y texto")).toBeVisible();
    expect(container.textContent ?? "").not.toContain("**");
    expect(container.textContent ?? "").not.toContain("](");
  });

  it("flattens the summaries through the safe parser, never through a markup path", () => {
    expect(dossierSource).toMatch(/from "\.\/rich-text-model"/);
    expect(dossierSource).toMatch(/toPlainText/);
    expect(dossierSource).not.toContain("dangerouslySetInnerHTML");
    expect(dossierSource).not.toContain("innerHTML");
  });
});

/**
 * Structural boundary: the preview stays the approved baseline card plus an
 * optional composition of the exploratory dossier. Every prototype-only
 * formatter, catalog lookup, clamp, and dossier element lives in the focused
 * `form/prototype-dossier` module.
 */
describe("VacancyPreview structural boundary", () => {
  it("stays a bounded surface that delegates the exploratory dossier", () => {
    expect(previewSource.split("\n").length).toBeLessThanOrEqual(230);
    expect(previewSource).toMatch(/from "\.\/form\/prototype-dossier"/);
    expect(previewSource).toMatch(/<PrototypeDossier prototype=\{prototype\} \/>/);
  });

  it("reuses the exported safe flattening helper for the contract description", () => {
    expect(previewSource).toMatch(/toPlainSummary/);
    // Reused, never re-implemented here.
    expect(previewSource).not.toContain("function toPlainSummary");
    expect(previewSource).not.toMatch(/parseRichText\s*\(/);
  });

  it("owns no prototype-only formatter, catalog lookup, clamp, or dossier markup", () => {
    for (const owned of [
      "Información complementaria",
      "Tecnologías",
      "MAX_VISIBLE_SKILLS",
      "Separat",
      "PAY_FREQUENCY_OPTIONS",
      "BENEFIT_OPTIONS",
      "parseRichText",
      "hasExploratoryContent",
      "function toPlainSummary",
      "function exploratoryRows",
      "function languageSummary",
      "function benefitSummary",
      "function formatClosingDate",
      "function payFrequencyLabel",
      "prototype.skills",
      "prototype.benefits",
      "prototype.languages",
      "prototype.department",
      "prototype.screeningQuestions",
      "prototype.requiredRequirements",
      "prototype.preferredRequirements",
      "prototype.closingDate",
      "prototype.descriptionRich",
      "descriptionRich",
      "payFrequency",
    ]) {
      expect(previewSource, `VacancyPreview.tsx must not own ${owned}`).not.toContain(
        owned,
      );
    }
  });

  it("keeps the dossier module focused, import-safe, and bounded", () => {
    expect(dossierSource.split("\n").length).toBeLessThanOrEqual(220);
    expect(dossierSource).toMatch(/export function PrototypeDossier/);
    expect(dossierSource).toMatch(/from "\.\/prototype-model"/);
    // The dossier carries product copy only: the complementary heading stays,
    // and no implementation-status label renders.
    expect(dossierSource).toMatch(/Información complementaria/);
    expect(dossierSource).not.toMatch(/Prototipo|todavía no se guardan/);
    // One-way dependency: the dossier never imports its consumer or the rail.
    expect(dossierSource).not.toMatch(/from "\.\.\/VacancyPreview"/);
    expect(dossierSource).not.toMatch(/draft-rail|createJob|requestJson|schemas|zod/);
    expect(dossierSource).not.toMatch(/\bfetch\s*\(/u);
    expect(dossierSource).not.toMatch(/^"use client"/m);
  });
});
