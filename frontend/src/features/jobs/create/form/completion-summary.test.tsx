import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CompletionSummary } from "./completion-summary";
import { vacancyCompletion } from "./completion-model";
import type { VacancyCompletionSection } from "./completion-model";
import { INITIAL_VALUES } from "./model";
import { INITIAL_PROTOTYPE_VALUES } from "./prototype-model";
import { toPlainText } from "./rich-text-model";
import { VACANCY_FORM_SECTIONS } from "./section-metadata";
import type { VacancyFormValues } from "./model";
import type { VacancyPrototypeValues } from "./prototype-model";

const NONE = [false, false, false, false, false, false];
const ALL = [true, true, true, true, true, true];

const withValues = (patch: Partial<VacancyFormValues> = {}): VacancyFormValues => ({ ...INITIAL_VALUES, ...patch });
const withPrototype = (patch: Partial<VacancyPrototypeValues> = {}): VacancyPrototypeValues => ({ ...INITIAL_PROTOTYPE_VALUES, ...patch });

/** The trimmed title plus the three chosen contract enums. */
const BASIC: Partial<VacancyFormValues> = { title: " Backend Developer ", workMode: "remote", employmentType: "full_time", seniority: "senior" };

/** The derived contract description of the requirements card. */
const DESCRIPTION = toPlainText("Diseñá los servicios core.");

/** A form where all six canonical sections hold content. */
const FULL_VALUES: VacancyFormValues = withValues({ ...BASIC, description: DESCRIPTION, salaryMin: "25000" });
const FULL_PROTOTYPE: VacancyPrototypeValues = withPrototype({
  department: "Ingeniería",
  languages: [{ id: "l1", language: "Inglés", level: "B2" }],
  benefits: ["health_insurance"],
  screeningQuestions: [{ id: "q1", prompt: "¿Cuántos años de experiencia?" }],
  closingDate: "2026-01-15",
});

const flags = (values = INITIAL_VALUES, prototype = INITIAL_PROTOTYPE_VALUES) =>
  vacancyCompletion(values, prototype).sections.map((section: VacancyCompletionSection) => section.complete);

/** Content cases: name, contract patch, prototype patch, six expected flags. */
type Case = [string, Partial<VacancyFormValues>, Partial<VacancyPrototypeValues>, boolean[]];
const CASES: Case[] = [
  ["an empty form", {}, {}, NONE],
  ["a title without the three enums", { title: "Backend Developer" }, {}, NONE],
  ["an optional location alone", { location: "Monterrey, NL" }, {}, NONE],
  ["complete basic information", BASIC, {}, [true, false, false, false, false, false]],
  ["one salary bound", { salaryMin: "25000" }, {}, [false, true, false, false, false, false]],
  ["the other salary bound", { salaryMax: "40000" }, {}, [false, true, false, false, false, false]],
  ["the default currency alone", { salaryCurrency: "USD" }, {}, NONE],
  ["a marker-only description", { description: toPlainText("**") }, {}, NONE],
  ["a plain-text description", { description: DESCRIPTION }, {}, [false, false, true, false, false, false]],
  ["the optional requirement lists", {}, { requiredRequirements: "- TypeScript", preferredRequirements: "- AWS" }, NONE],
  ["a department", {}, { department: " Ingeniería " }, [false, false, false, true, false, false]],
  ["one skill", {}, { skills: ["React"] }, [false, false, false, true, false, false]],
  ["a named language", {}, { languages: [{ id: "l1", language: " Inglés ", level: "" }] }, [false, false, false, true, false, false]],
  ["a closing date", {}, { closingDate: "2026-01-15" }, [false, false, false, true, false, false]],
  ["a level without a language name", {}, { languages: [{ id: "l1", language: "  ", level: "B2" }] }, NONE],
  ["a blank department", {}, { department: "   " }, NONE],
  ["one benefit", {}, { benefits: ["extra_time_off"] }, [false, false, false, false, true, false]],
  ["a pay frequency", {}, { payFrequency: "monthly" }, [false, false, false, false, true, false]],
  ["a screening prompt", {}, { screeningQuestions: [{ id: "q1", prompt: " ¿Cuántos años? " }] }, [false, false, false, false, false, true]],
  ["a blank screening prompt", {}, { screeningQuestions: [{ id: "q1", prompt: "   " }] }, NONE],
  ["content in every section", FULL_VALUES, FULL_PROTOTYPE, ALL],
];

const CARD = "[data-pf-completion-summary]";
const BAR = { name: "Secciones de la vacante con contenido" } as const;
const count = (completed: number) => `${completed} de 6 secciones completas`;

function renderCard(values = INITIAL_VALUES, prototypeValues = INITIAL_PROTOTYPE_VALUES): HTMLElement {
  const { container } = render(<CompletionSummary values={values} prototypeValues={prototypeValues} />);
  const card = container.querySelector(CARD);
  if (card === null) throw new Error("The completion card was not rendered");
  return card as HTMLElement;
}

function expectBar(label: string, now: string, width: string) {
  const bar = screen.getByRole("progressbar", BAR);
  expect(screen.getByText(label)).toBeVisible();
  expect(bar).toHaveAttribute("aria-valuemin", "0");
  expect(bar).toHaveAttribute("aria-valuemax", "6");
  expect(bar).toHaveAttribute("aria-valuenow", now);
  expect(bar).toHaveAttribute("aria-valuetext", label);
  expect(bar.firstElementChild).toHaveStyle({ width });
}

afterEach(cleanup);

describe("vacancyCompletion observable-content model", () => {
  it.each(CASES)("flags content for %s", (_name: string, values: Partial<VacancyFormValues>, prototype: Partial<VacancyPrototypeValues>, expected: boolean[]) => {
    expect(flags(withValues(values), withPrototype(prototype))).toEqual(expected);
  });

  it("keeps the canonical six-section order, titles, and count", () => {
    const summary = vacancyCompletion(INITIAL_VALUES, INITIAL_PROTOTYPE_VALUES);
    expect(summary.total).toBe(6);
    expect(summary.completed).toBe(0);
    expect(summary.sections.map((section: VacancyCompletionSection) => [section.id, section.title]))
      .toEqual(VACANCY_FORM_SECTIONS.map((section) => [section.id, section.title]));
  });
});

describe("CompletionSummary card", () => {
  it("titles the card, discloses its scope, and reports the count accessibly", () => {
    const card = renderCard();

    expect(within(card).getByRole("heading", { name: "Progreso de la vacante" })).toBeVisible();
    expect(within(card).getByText("Revisa qué secciones tienen contenido antes de guardar el borrador.")).toBeVisible();
    expectBar(count(0), "0", "0%");

    cleanup();
    renderCard(FULL_VALUES, FULL_PROTOTYPE);
    expectBar(count(6), "6", "100%");
    expect(screen.getAllByText("Completa")).toHaveLength(6);
  });

  it("lists the six canonical titles with a visible status and a hidden icon", () => {
    const card = renderCard();
    const items = Array.from(card.querySelectorAll("[data-pf-completion-item]"));

    expect(items.map((item) => item.getAttribute("data-pf-completion-item")))
      .toEqual(VACANCY_FORM_SECTIONS.map((section) => section.id));

    for (const [index, section] of VACANCY_FORM_SECTIONS.entries()) {
      const item = items[index] as HTMLElement;
      expect(within(item).getByText(section.title)).toBeVisible();
      const status = within(item).getByText("Pendiente");
      expect(status).toBeVisible();
      expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("stays non-interactive and claims nothing about validity or saving", () => {
    const card = renderCard(FULL_VALUES, FULL_PROTOTYPE);
    const text = card.textContent ?? "";

    // No navigation duplication, no control, no live region, one progress role.
    expect(within(card).queryAllByRole("link")).toHaveLength(0);
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(card.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(within(card).getByRole("progressbar", BAR)).toBeVisible();
    // Never a bare percentage, and never a save, sync, or autosave claim.
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/autoguardado|guardado automáticamente|borrador guardado|sincronizado|listo para guardar/i);
  });
});

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const SOURCES = [
  ["completion-summary.tsx", readFileSync(join(FORM_DIR, "completion-summary.tsx"), "utf8")],
  ["completion-model.ts", readFileSync(join(FORM_DIR, "completion-model.ts"), "utf8")],
] as const;

/** Executable source only, so documentation prose cannot satisfy a code guard. */
const code = (text: string) => text.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("completion summary boundaries", () => {
  it("recomputes observable content with no state, effect, async, transport, or control", () => {
    for (const [name, text] of SOURCES) {
      expect(code(text), name).not.toMatch(/useState|useEffect|useMemo|useReducer|useSyncExternalStore|\basync\b|\bawait\b/);
      expect(code(text), name).not.toMatch(/createJob|requestJson|lib\/api|schemas|zod|safeParse|validateVacancyForm|attemptDraftSave/);
      expect(code(text), name).not.toMatch(/\bfetch\s*\(|\bcookies?\b|\bsession\b|\bbearer\b|accessToken/i);
    }
    // No control, no navigation, no live region of its own; one progress role.
    expect(SOURCES[0][1]).not.toMatch(/<Button|<a\s|href=|aria-live/);
    expect(SOURCES[0][1]).toMatch(/role="progressbar"/);
  });
});
