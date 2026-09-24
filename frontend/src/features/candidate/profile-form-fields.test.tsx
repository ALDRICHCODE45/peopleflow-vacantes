import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CEFR_LEVELS, CEFR_LEVEL_LABELS, EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, SALARY_PERIOD_LABELS, SALARY_PERIODS } from "./model";
import { CANDIDATE_PROFILE } from "./prototype-candidate";
import { profileToDraft } from "./profile-draft";
import type { CandidateProfileDraft, ProfileDraftIssue } from "./profile-draft";
import { draftValueFromSelect, ProfileFormFields, toSelectItems } from "./profile-form-fields";

// Source as text, so the coupling, token and side-effect contracts stay asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/features/candidate", "profile-form-fields.tsx"), "utf8");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
/** The 18 scalar draft fields in canonical group order; `languages` is the 19th. */
const SCALARS = ["professionalTitle", "currentCompany", "yearsOfExperience", "summary", "phone", "linkedinUrl", "portfolioUrl", "birthDate", "city", "country", "educationLevel", "fieldOfStudy", "skills", "currentSalaryGross", "currentSalaryNet", "expectedSalary", "salaryCurrency", "expectedSalaryPeriod"] as const;
const LABELS: Readonly<Record<(typeof SCALARS)[number], string>> = {
  professionalTitle: "Título profesional", currentCompany: "Empresa actual o última", yearsOfExperience: "Años de experiencia", summary: "Resumen profesional",
  phone: "Teléfono", linkedinUrl: "Perfil de LinkedIn", portfolioUrl: "Portafolio o sitio web", birthDate: "Fecha de nacimiento", city: "Ciudad de residencia", country: "País",
  educationLevel: "Nivel máximo de estudios", fieldOfStudy: "Campo de estudio", skills: "Habilidades",
  currentSalaryGross: "Salario bruto actual", currentSalaryNet: "Salario neto actual", expectedSalary: "Salario esperado", salaryCurrency: "Moneda", expectedSalaryPeriod: "Periodo del salario esperado",
};
const GROUPS = [["contact", "Contacto"], ["location", "Ubicación"], ["professional", "Perfil profesional"], ["trajectory", "Trayectoria"], ["education", "Formación académica"], ["skills", "Habilidades"], ["compensation", "Salario actual"], ["expectation", "Expectativas salariales"], ["languages", "Idiomas"]] as const;
const BOUNDED = [["yearsOfExperience", "60"], ["currentSalaryGross", "100000000"], ["currentSalaryNet", "100000000"], ["expectedSalary", "100000000"]] as const;
type ChangeSpy = Mock<(next: CandidateProfileDraft) => void>;

const draft = (patch: Partial<CandidateProfileDraft> = {}): CandidateProfileDraft => ({ ...profileToDraft(CANDIDATE_PROFILE), ...patch });
const renderFields = (options: { draft?: CandidateProfileDraft; issues?: readonly ProfileDraftIssue[] } = {}) => {
  const onChange = vi.fn<(next: CandidateProfileDraft) => void>();
  const view = render(<ProfileFormFields draft={options.draft ?? draft()} issues={options.issues ?? []} onChange={onChange} />);
  return { onChange, ...view };
};
/** The full next draft of the most recent emission; fails loudly instead of returning a default. */
const emitted = (spy: ChangeSpy): CandidateProfileDraft => {
  const call = spy.mock.calls.at(-1);
  if (call === undefined) throw new Error("expected at least one onChange call");
  return call[0];
};
const field = (container: HTMLElement, path: string) => container.querySelector(`[data-pf-profile-field="${path}"]`) as HTMLElement;
const input = (container: HTMLElement, path: string) => field(container, path) as HTMLInputElement;
const classes = (node: Element | null) => node?.getAttribute("class") ?? "";
const modulesOf = (source: string) => [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
afterEach(cleanup);

describe("profile form fields inventory", () => {
  it("renders the nine section groups that the five tabs distribute without a native control", () => {
    const { container, onChange } = renderFields();
    expect(onChange).not.toHaveBeenCalled();
    const groups = Array.from(container.querySelectorAll("[data-pf-profile-group]"));
    expect(groups.map((group) => group.getAttribute("data-pf-profile-group"))).toEqual(GROUPS.map(([slug]) => slug));
    const rendered = Array.from(container.querySelectorAll("[data-pf-profile-field]")).map((node) => node.getAttribute("data-pf-profile-field") as string);
    expect([...rendered].sort()).toEqual([...SCALARS, "languages"].sort());
    const sectionCards = Array.from(container.querySelectorAll("[data-pf-profile-section-card]"));
    expect(sectionCards).toHaveLength(9);
    expect(sectionCards.every((card) => card.getAttribute("data-slot") === "card")).toBe(true);
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });

  it("maps every field to an explicit label, stable id and schema-aligned native metadata", () => {
    const { container } = renderFields();
    const current = draft();
    for (const path of SCALARS) {
      expect(input(container, path).id, path).toBe(`profile-${path}`);
      expect(container.querySelector(`label[for="profile-${path}"]`)?.textContent, path).toBe(LABELS[path]);
    }
    expect(input(container, "phone")).toHaveAttribute("type", "tel");
    expect(input(container, "phone")).toHaveAttribute("maxlength", "30");
    expect(input(container, "phone")).toHaveValue(current.phone);
    for (const path of ["linkedinUrl", "portfolioUrl"] as const) {
      expect(input(container, path), path).toHaveAttribute("type", "url");
      expect(input(container, path), path).toHaveAttribute("maxlength", "300");
      expect(input(container, path), path).toHaveValue(current[path]);
    }
    expect(input(container, "professionalTitle")).toHaveValue(current.professionalTitle);
    expect(input(container, "professionalTitle")).toHaveAttribute("maxlength", "120");
    expect(input(container, "salaryCurrency")).toHaveAttribute("maxlength", "3");
    expect(input(container, "salaryCurrency")).toHaveValue("MXN");
    for (const [path, max] of BOUNDED) {
      const node = input(container, path);
      expect([node.type, node.getAttribute("min"), node.getAttribute("max"), node.getAttribute("step")], path).toEqual(["number", "0", max, "1"]);
    }
    expect(input(container, "yearsOfExperience")).toHaveValue(9);
    expect(input(container, "expectedSalary")).toHaveValue(75000);
    for (const path of ["summary", "skills"] as const) {
      const node = field(container, path);
      expect([node.tagName, node.getAttribute("aria-describedby")], path).toEqual(["TEXTAREA", null]);
      expect(node).toHaveValue(current[path]);
    }
    expect(field(container, "summary")).toHaveAttribute("maxlength", "2000");
  });

  it("routes the birth date through the shared DatePickerField instead of a native date input", () => {
    const { container } = renderFields();
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-slot="date-picker-field"]')).toHaveLength(1);
    expect(container.querySelectorAll("[data-pf-profile-hint], [id$='-hint']")).toHaveLength(0);
    const control = container.querySelector("#profile-birthDate") as HTMLElement;
    expect([control.tagName, control.getAttribute("aria-describedby")]).toEqual(["BUTTON", null]);
    expect(control).toHaveTextContent("18 de junio de 1994");
    expect(SOURCE).toContain('from "@/components/ui/date-picker-field"');
    // Birth dates need the past-date mode; the vacancy closing date keeps its default.
    expect(SOURCE).toMatch(/allowPast/u);
    expect(SOURCE).not.toMatch(/type:\s*"date"|type="date"/u);
    expect(SOURCE).not.toContain("FieldDescription");
  });

  it("offers the exact closed vocabularies through the full shadcn Select composition", () => {
    const { container } = renderFields();
    const education = field(container, "educationLevel");
    const period = field(container, "expectedSalaryPeriod");
    const cefr = screen.getByLabelText("Nivel del idioma 1");
    for (const trigger of [education, period, cefr]) {
      expect(trigger.tagName).toBe("BUTTON");
      expect(trigger).toHaveAttribute("data-slot", "select-trigger");
      expect(trigger.querySelector('[data-slot="select-value"]')).not.toBeNull();
    }
    expect(education).toHaveTextContent(EDUCATION_LEVEL_LABELS.bachelor);
    expect(period).toHaveTextContent(SALARY_PERIOD_LABELS.monthly);
    expect(cefr).toHaveTextContent(CEFR_LEVEL_LABELS.C2);
    expect(toSelectItems([{ value: "", label: "Sin especificar" }, ...EDUCATION_LEVELS.map((value) => ({ value, label: EDUCATION_LEVEL_LABELS[value] }))])).toEqual([
      { value: null, label: "Sin especificar" },
      ...EDUCATION_LEVELS.map((value) => ({ value, label: EDUCATION_LEVEL_LABELS[value] })),
    ]);
    expect(draftValueFromSelect(null)).toBe("");
    for (const value of [...SALARY_PERIODS, ...CEFR_LEVELS]) expect(draftValueFromSelect(value)).toBe(value);
    for (const part of ["<SelectContent>", "<SelectGroup>", "<SelectItem", "onValueChange={(next) =>"]) expect(SOURCE).toContain(part);
  });
});

describe("profile form fields emissions", () => {
  it("emits one full immutable draft per scalar, number, textarea and select edit", () => {
    const base = draft();
    const before = JSON.stringify(base);
    const { onChange } = renderFields({ draft: base });
    fireEvent.change(screen.getByLabelText(LABELS.city), { target: { value: `${base.city}!` } });
    expect(emitted(onChange)).toEqual({ ...base, city: `${base.city}!` });
    expect(emitted(onChange)).not.toBe(base);
    expect(Object.keys(emitted(onChange)).sort()).toEqual(Object.keys(base).sort());
    expect(emitted(onChange).languages).toEqual(base.languages);
    expect(SOURCE).toContain("onChange(draftValueFromSelect(next))");
    fireEvent.change(screen.getByLabelText(LABELS.yearsOfExperience), { target: { value: "12" } });
    expect(emitted(onChange).yearsOfExperience).toBe("12");
    fireEvent.change(screen.getByLabelText(LABELS.yearsOfExperience), { target: { value: "" } });
    expect(emitted(onChange).yearsOfExperience).toBe("");
    fireEvent.change(screen.getByLabelText(LABELS.summary), { target: { value: `${base.summary}.` } });
    expect(emitted(onChange).summary).toBe(`${base.summary}.`);
    expect(emitted(onChange).skills).toBe(base.skills);
    fireEvent.change(screen.getByLabelText(LABELS.salaryCurrency), { target: { value: "" } });
    expect(emitted(onChange).salaryCurrency).toBe("");
    fireEvent.change(screen.getByLabelText(LABELS.salaryCurrency), { target: { value: "usd" } });
    expect(emitted(onChange).salaryCurrency).toBe("usd");
    expect(JSON.stringify(base)).toBe(before);
  });

  it("edits, appends and removes language rows by position without mutating any row or array", () => {
    const base = draft();
    const before = JSON.stringify(base);
    const { onChange } = renderFields({ draft: base });
    expect(screen.getAllByRole("button", { name: /^Quitar idioma \d$/u }).map((button) => button.textContent)).toEqual(["Quitar idioma 1", "Quitar idioma 2"]);
    fireEvent.change(screen.getByLabelText("Nombre del idioma 2"), { target: { value: `${base.languages[1].name}!` } });
    const edited = emitted(onChange);
    expect(edited.languages[1]).toEqual({ name: `${base.languages[1].name}!`, level: "B2" });
    expect(edited.languages[0]).toBe(base.languages[0]);
    expect(edited.languages).not.toBe(base.languages);
    expect(draftValueFromSelect(null)).toBe("");
    expect(draftValueFromSelect("A1")).toBe("A1");
    expect(SOURCE).toContain("level: draftValueFromSelect(next)");
    fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));
    const added = emitted(onChange);
    expect(added.languages).toEqual([...base.languages, { name: "", level: "" }]);
    expect(added.languages.at(-1)?.level).toBe("");
    expect(added.languages.at(-1)).not.toBe(base.languages[1]);
    fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 1" }));
    expect(emitted(onChange).languages).toEqual([base.languages[1]]);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("profile form fields error wiring", () => {
  const issues: readonly ProfileDraftIssue[] = [
    { path: "phone", message: "El teléfono debe tener al menos 5 caracteres." },
    { path: "phone", message: "Mensaje duplicado que debe ignorarse." },
    { path: "summary", message: "El resumen debe tener como máximo 2000 caracteres." },
    { path: "languages", message: "Puedes registrar hasta 20 idiomas." },
    { path: "languages.1.level", message: "El nivel del idioma debe ser uno de A1, A2, B1, B2, C1 o C2." },
    { path: "birthDate", message: "La fecha de nacimiento no puede estar en el futuro." },
  ];

  it("links only the failing controls to the first visible Spanish issue per path", () => {
    const { container } = renderFields({ issues });
    const phone = input(container, "phone");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone.getAttribute("aria-describedby")).toContain("profile-phone-error");
    expect(container.querySelector("#profile-phone-error")).toHaveTextContent(issues[0].message);
    expect(container.querySelector("#profile-phone-error")).not.toHaveTextContent("Mensaje duplicado");
    expect(input(container, "city")).not.toHaveAttribute("aria-invalid");
    expect(input(container, "city").getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(5);
    // Without helper lines the adjacent error is the only described-by target.
    const birthDate = container.querySelector("#profile-birthDate") as HTMLElement;
    expect([birthDate.tagName, birthDate.getAttribute("aria-invalid"), birthDate.getAttribute("aria-describedby")]).toEqual(["BUTTON", "true", "profile-birthDate-error"]);
    expect(container.querySelector("#profile-birthDate-error")).toHaveTextContent(issues[5].message);
    expect(container.querySelector('[data-pf-profile-group="languages"]')?.getAttribute("aria-describedby")).toBe("profile-languages-error");
    expect(container.querySelector("#profile-languages-error")).toHaveTextContent("Puedes registrar hasta 20 idiomas.");
    const level = screen.getByLabelText("Nivel del idioma 2");
    expect(level).toHaveAttribute("aria-invalid", "true");
    expect(level.getAttribute("aria-describedby")).toBe("profile-language-1-level-error");
    expect(container.querySelector("#profile-language-1-level-error")).toHaveTextContent(issues[4].message);
    expect(screen.getByLabelText("Nombre del idioma 1")).not.toHaveAttribute("aria-invalid");
    expect(field(container, "summary")).toHaveAttribute("aria-invalid", "true");
  });

  it("renders no error affordance and no invented validation when there are no issues", () => {
    const { container } = renderFields({ issues: [] });
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(0);
    expect(container.querySelectorAll("[aria-invalid]")).toHaveLength(0);
    expect(field(container, "summary").getAttribute("aria-describedby")).toBeNull();
  });
});

describe("profile form fields composition", () => {
  it("frames the fields in nine quiet cards without heading chips or section blurbs", () => {
    const { container } = renderFields();
    const sections = Array.from(container.querySelectorAll("[data-pf-profile-group]"));
    expect(sections).toHaveLength(9);
    expect(container.querySelectorAll("[data-pf-profile-section-icon]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-pf-profile-section-hint]")).toHaveLength(0);
    expect(container.querySelectorAll('[data-slot="field-description"]')).toHaveLength(0);
    for (const label of container.querySelectorAll('[data-slot="field-label"]')) expect(label.querySelector("svg")).toBeNull();
    expect(SOURCE).not.toMatch(/PhoneIcon|Link2Icon|Globe2Icon|CalendarDaysIcon|MapPinnedIcon|EarthIcon|BadgeCheckIcon|Building2Icon|AwardIcon|ScrollTextIcon|GraduationCapIcon|BookOpenIcon|SparklesIcon|BanknoteIcon|CoinsIcon|HashIcon|WalletIcon|CalendarClockIcon|LanguagesIcon/u);
    expect(SOURCE).not.toContain("blurb");
    expect(SOURCE).toContain("PlusIcon");
    expect(SOURCE).toContain("Trash2Icon");
    // Every section Card shares one neutral ring: no accent/neutral split and no hover paint.
    const sectionCards = Array.from(container.querySelectorAll("[data-pf-profile-section-card]"));
    expect(sectionCards).toHaveLength(9);
    for (const card of sectionCards) {
      expect(card.className).toContain("ring-border/70");
      expect(card.className).not.toContain("ring-primary");
      expect(card.className).not.toContain("hover:ring");
    }
    expect(SOURCE).not.toMatch(/CARD_ACCENT|CARD_NEUTRAL/u);
    expect(SOURCE).not.toContain("hover:ring");
    expect(SOURCE).not.toContain("ring-primary");
    expect(sections.map((node) => [node.getAttribute("data-pf-profile-group"), node.querySelector("legend")?.textContent])).toEqual(GROUPS.map(([slug, legend]) => [slug, legend]));
    const grids = Array.from(container.querySelectorAll("[data-pf-profile-fields-grid]"));
    expect(grids).toHaveLength(8);
    const columns = grids.map((grid) => classes(grid).match(/sm:grid-cols-(?:\d+|\[[^\]]+\])/u)?.[0] ?? "");
    expect(new Set(columns).size).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll("[data-pf-profile-fields-grid] [class*='col-span-']").length).toBeGreaterThanOrEqual(6);
  });

  it("titles each section Card through CardHeader and CardTitle while the group legend stays sr-only", () => {
    const { container } = renderFields();
    const cards = Array.from(container.querySelectorAll("[data-pf-profile-section-card]")) as HTMLElement[];
    expect(cards).toHaveLength(9);
    const titles = cards.map((card) => {
      const header = card.querySelector("[data-slot='card-header']") as HTMLElement | null;
      expect(header, "every section Card needs its own CardHeader").not.toBeNull();
      // Normal shadcn header rhythm: no zeroed or edge-flush spacing override.
      expect(classes(header)).not.toContain("mb-0");
      expect(classes(header)).not.toMatch(/(?:^|\s)(?:m[xytblr]?-0|p[xytblr]?-0)(?:\s|$)/u);
      const legend = card.querySelector("[data-slot='field-legend']") as HTMLElement | null;
      expect(legend, "every FieldSet keeps its accessible group legend").not.toBeNull();
      expect(classes(legend)).toContain("sr-only");
      const title = header?.querySelector("[data-slot='card-title']") as HTMLElement | null;
      expect(title, "every section Card needs a visible CardTitle").not.toBeNull();
      expect(classes(title)).not.toContain("sr-only");
      return title?.textContent?.trim() ?? "";
    });
    expect(titles).toEqual(GROUPS.map(([, legend]) => legend));
    const headers = Array.from(container.querySelectorAll("[data-slot='card-header']"));
    expect(headers).toHaveLength(9);
    expect(container.querySelectorAll("[data-slot='card-title']")).toHaveLength(9);
    expect(container.querySelectorAll("[data-slot='card-description']")).toHaveLength(0);
    for (const header of headers) expect(header.querySelector("svg")).toBeNull();
    for (const legend of container.querySelectorAll("[data-slot='field-legend']")) expect(classes(legend)).toContain("sr-only");
    expect(SOURCE).toContain("CardHeader");
    expect(SOURCE).toContain("CardTitle");
  });

  it("keeps contextual adornments on the numeric fields without helper lines", () => {
    const { container } = renderFields();
    for (const path of ["yearsOfExperience", "currentSalaryGross", "currentSalaryNet", "expectedSalary"] as const) {
      const control = input(container, path);
      const group = control.closest('[data-slot="input-group"]');
      expect(group, path).not.toBeNull();
      expect(group?.querySelector("[data-slot=input-group-addon]")?.textContent ?? "", path).toMatch(/[a-zA-Z]/u);
      expect(control, path).not.toHaveAttribute("aria-describedby");
      expect(container.querySelector(`#profile-${path}-hint`), path).toBeNull();
    }
    expect(input(container, "yearsOfExperience")).toHaveValue(9);
    expect(input(container, "expectedSalary")).toHaveValue(75000);
  });

  it("keeps every control on a shadcn field primitive with badges, one divider and one date picker", () => {
    const { container } = renderFields();
    expect(container.querySelectorAll('[data-slot="field-set"]')).toHaveLength(9);
    expect(container.querySelectorAll('[data-slot="field"]')).toHaveLength(SCALARS.length + 2 * draft().languages.length);
    expect(container.querySelectorAll('[data-slot="field-legend"]')).toHaveLength(9);
    expect(container.querySelectorAll('[data-slot="field-description"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-slot="field-label"]')).toHaveLength(SCALARS.length + 2 * draft().languages.length);
    expect(container.querySelectorAll('[data-slot="input-group"]')).toHaveLength(SCALARS.length - 1);
    expect(container.querySelectorAll('[data-slot="date-picker-field"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="badge"]')).toHaveLength(draft().languages.length);
    expect(container.querySelectorAll("[data-pf-profile-divider]")).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(2 + draft().languages.length);
    for (const trigger of container.querySelectorAll('[data-slot="select-trigger"]')) expect(trigger.querySelector('[data-slot="select-value"]')).not.toBeNull();
    expect(container.querySelectorAll('[style]:not([aria-hidden="true"])')).toHaveLength(0);
  });
});

describe("profile form fields contract", () => {
  it("keeps 40px targets, visible focus, token-only paint and responsive grids", () => {
    const { container } = renderFields();
    for (const node of container.querySelectorAll("input:not([aria-hidden='true']), button")) expect(classes(node)).toContain("min-h-10");
    for (const node of container.querySelectorAll("textarea")) expect(classes(node)).toContain("min-h-24");
    // Every editable control carries the visible focus ring itself, or inherits it from its input-group frame.
    for (const node of container.querySelectorAll("input:not([aria-hidden='true']), textarea, button")) {
      const frameRing = classes(node.closest('[data-slot="input-group"]')).includes("focus-visible]:ring-3");
      expect(classes(node).includes("focus-visible:ring-3") || frameRing, node.tagName).toBe(true);
    }
    const grids = Array.from(container.querySelectorAll("[data-pf-profile-fields-grid]"));
    expect(grids).toHaveLength(8);
    for (const grid of grids) expect([classes(grid).includes("grid-cols-1"), /sm:grid-cols-(?:\d+|\[[^\]]+\])/u.test(classes(grid))]).toEqual([true, true]);
    const columns = grids.map((grid) => classes(grid).match(/sm:grid-cols-(?:\d+|\[[^\]]+\])/u)?.[0] ?? "");
    expect(new Set(columns).size).toBeGreaterThanOrEqual(3);
    // Ubicación keeps one row of three at sm+: a wider date column, then Ciudad and País.
    expect(classes(grids[1])).toContain("sm:grid-cols-[1.25fr_1.05fr_0.7fr]");
    for (const grid of grids) expect(classes(grid)).not.toMatch(/(?:^|\s)flex(?:\s|$)/u);
    const row = container.querySelector("[data-pf-profile-language-row]") as HTMLElement;
    const rowGrid = row.querySelector("[data-pf-profile-language-grid]") as HTMLElement;
    expect([classes(row).includes("border"), classes(rowGrid).includes("grid-cols-1"), classes(rowGrid).includes("sm:grid-cols-2")]).toEqual([true, true, true]);
    expect(SOURCE).toContain("motion-reduce:transition-none");
    expect(container.querySelector("[data-pf-profile-language-add]")).toHaveTextContent("Agregar idioma");
    expect(container.querySelectorAll("[data-slot='select-trigger']")).toHaveLength(2 + draft().languages.length);
    expect(container.querySelectorAll("[data-pf-profile-language-remove], [data-pf-profile-language-add]")).toHaveLength(3);
    expect(RAW_COLOR.test(Array.from(container.querySelectorAll("[class]")).map(classes).join(" "))).toBe(false);
    expect(container.querySelectorAll('[style]:not([aria-hidden="true"])')).toHaveLength(0);
    expect(SOURCE).not.toMatch(/w-\[\d+px\]|overflow-x|w-screen/u);
    expect(SOURCE).not.toContain("<select");
  });

  it("stays a controlled, form-free and validation-free surface with no side effect or fixture", () => {
    const { container } = renderFields();
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="group"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[type="submit"], [type="reset"]')).toHaveLength(0);
    expect(modulesOf(SOURCE)).toEqual(["./model", "./profile-draft", "@/components/ui/badge", "@/components/ui/button", "@/components/ui/card", "@/components/ui/date-picker-field", "@/components/ui/field", "@/components/ui/input-group", "@/components/ui/select", "@/components/ui/separator", "lucide-react"]);
    expect(SOURCE).toMatch(/^"use client";/u);
    for (const forbidden of ["email", "fullName", "userId", "createdAt", "updatedAt", "cv", "auth", "password", "useState", "useReducer", "useEffect", "useRef", "<form", "onSubmit", "submit", "reset", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.", "document.", "window.", "useRouter", "next/navigation", "setTimeout", "setInterval", "Math.random", "Date.now", "prototype-", "profile-draft.test", "parseProfileDraft", "safeParse", "validate"]) {
      expect(SOURCE, `profile-form-fields.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
    expect(SOURCE).not.toMatch(/from "react|from "react-dom/u);
  });
});