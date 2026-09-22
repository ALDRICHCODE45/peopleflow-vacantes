import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CEFR_LEVELS, CEFR_LEVEL_LABELS, EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, SALARY_PERIOD_LABELS, SALARY_PERIODS } from "./model";
import { CANDIDATE_PROFILE } from "./prototype-candidate";
import { profileToDraft } from "./profile-draft";
import type { CandidateProfileDraft, ProfileDraftIssue } from "./profile-draft";
import { ProfileFormFields } from "./profile-form-fields";

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
const GROUPS = [["professional", "Perfil profesional"], ["contact", "Contacto y ubicación"], ["education", "Educación y habilidades"], ["compensation", "Expectativas salariales"], ["languages", "Idiomas"]] as const;
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
const optionsOf = (select: HTMLSelectElement) => ({ values: Array.from(select.options).map((option) => option.value), labels: Array.from(select.options).map((option) => option.textContent) });
const modulesOf = (source: string) => [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
afterEach(cleanup);

describe("profile form fields inventory", () => {
  it("renders the 19 editable draft fields exactly once in five semantic fieldsets", () => {
    const { container, onChange } = renderFields();
    expect(onChange).not.toHaveBeenCalled();
    const rendered = Array.from(container.querySelectorAll("[data-pf-profile-field]")).map((node) => node.getAttribute("data-pf-profile-field"));
    expect(rendered).toEqual([...SCALARS, "languages"]);
    const fieldsets = Array.from(container.querySelectorAll("fieldset"));
    expect(fieldsets).toHaveLength(5);
    expect(fieldsets.map((group) => [group.getAttribute("data-pf-profile-group"), group.querySelector("legend")?.textContent])).toEqual(GROUPS.map(([slug, legend]) => [slug, legend]));
    expect(fieldsets.map((group) => (group.matches("[data-pf-profile-field]") ? 1 : 0) + group.querySelectorAll("[data-pf-profile-field]").length)).toEqual([4, 6, 3, 5, 1]);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(SCALARS.length + 2 * draft().languages.length);
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
    expect(input(container, "birthDate")).toHaveAttribute("type", "date");
    expect(input(container, "birthDate")).toHaveValue("1994-06-18");
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
      expect([node.tagName, node.getAttribute("aria-describedby")], path).toEqual(["TEXTAREA", `profile-${path}-hint`]);
      expect(container.querySelector(`#profile-${path}-hint`)).toHaveTextContent(/[a-zA-Z]/u);
      expect(node).toHaveValue(current[path]);
    }
    expect(field(container, "summary")).toHaveAttribute("maxlength", "2000");
  });

  it("offers the exact closed vocabularies plus their blank option, with current values", () => {
    const { container } = renderFields();
    const education = field(container, "educationLevel") as HTMLSelectElement;
    expect(education.tagName).toBe("SELECT");
    expect(optionsOf(education)).toEqual({ values: ["", ...EDUCATION_LEVELS], labels: ["Sin especificar", ...EDUCATION_LEVELS.map((level) => EDUCATION_LEVEL_LABELS[level])] });
    expect(education).toHaveValue("bachelor");
    const period = field(container, "expectedSalaryPeriod") as HTMLSelectElement;
    expect(optionsOf(period)).toEqual({ values: ["", ...SALARY_PERIODS], labels: ["Sin especificar", ...SALARY_PERIODS.map((period) => SALARY_PERIOD_LABELS[period])] });
    expect(period).toHaveValue("monthly");
    expect(screen.getByLabelText("Nombre del idioma 1")).toHaveValue("español");
    const cefr = screen.getByLabelText("Nivel del idioma 1") as HTMLSelectElement;
    expect(optionsOf(cefr)).toEqual({ values: ["", ...CEFR_LEVELS], labels: ["Sin especificar", ...CEFR_LEVELS.map((level) => CEFR_LEVEL_LABELS[level])] });
    expect(cefr).toHaveValue("C2");
  });
});

describe("profile form fields emissions", () => {
  it("emits one full immutable draft per scalar, number, textarea and select edit", async () => {
    const user = userEvent.setup();
    const base = draft();
    const before = JSON.stringify(base);
    const { onChange } = renderFields({ draft: base });
    await user.type(screen.getByLabelText(LABELS.city), "!");
    expect(emitted(onChange)).toEqual({ ...base, city: `${base.city}!` });
    expect(emitted(onChange)).not.toBe(base);
    expect(Object.keys(emitted(onChange)).sort()).toEqual(Object.keys(base).sort());
    expect(emitted(onChange).languages).toEqual(base.languages);
    await user.selectOptions(screen.getByLabelText(LABELS.educationLevel), "master");
    expect(emitted(onChange).educationLevel).toBe("master");
    fireEvent.change(screen.getByLabelText(LABELS.yearsOfExperience), { target: { value: "12" } });
    expect(emitted(onChange).yearsOfExperience).toBe("12");
    fireEvent.change(screen.getByLabelText(LABELS.yearsOfExperience), { target: { value: "" } });
    expect(emitted(onChange).yearsOfExperience).toBe("");
    await user.type(screen.getByLabelText(LABELS.summary), ".");
    expect(emitted(onChange).summary).toBe(`${base.summary}.`);
    expect(emitted(onChange).skills).toBe(base.skills);
    await user.clear(screen.getByLabelText(LABELS.salaryCurrency));
    expect(emitted(onChange).salaryCurrency).toBe("");
    fireEvent.change(screen.getByLabelText(LABELS.salaryCurrency), { target: { value: "usd" } });
    expect(emitted(onChange).salaryCurrency).toBe("usd");
    expect(JSON.stringify(base)).toBe(before);
  });

  it("edits, appends and removes language rows by position without mutating any row or array", async () => {
    const user = userEvent.setup();
    const base = draft();
    const before = JSON.stringify(base);
    const { onChange } = renderFields({ draft: base });
    expect(screen.getAllByRole("button", { name: /^Quitar idioma \d$/u }).map((button) => button.textContent)).toEqual(["Quitar idioma 1", "Quitar idioma 2"]);
    await user.type(screen.getByLabelText("Nombre del idioma 2"), "!");
    const edited = emitted(onChange);
    expect(edited.languages[1]).toEqual({ name: `${base.languages[1].name}!`, level: "B2" });
    expect(edited.languages[0]).toBe(base.languages[0]);
    expect(edited.languages).not.toBe(base.languages);
    await user.selectOptions(screen.getByLabelText("Nivel del idioma 1"), "");
    expect(emitted(onChange).languages[0]).toEqual({ name: base.languages[0].name, level: "" });
    await user.selectOptions(screen.getByLabelText("Nivel del idioma 2"), "A1");
    // Each emission is derived from the received prop, so the level edit carries the original name.
    expect(emitted(onChange).languages).toEqual([base.languages[0], { name: base.languages[1].name, level: "A1" }]);
    await user.click(screen.getByRole("button", { name: "Agregar idioma" }));
    const added = emitted(onChange);
    expect(added.languages).toEqual([...base.languages, { name: "", level: "" }]);
    expect(added.languages.at(-1)?.level).toBe("");
    expect(added.languages.at(-1)).not.toBe(base.languages[1]);
    await user.click(screen.getByRole("button", { name: "Quitar idioma 1" }));
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
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(4);
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
    expect(field(container, "summary").getAttribute("aria-describedby")).toBe("profile-summary-hint");
  });
});

describe("profile form fields contract", () => {
  it("keeps 40px targets, visible focus, token-only paint and responsive grids", () => {
    const { container } = renderFields();
    for (const node of container.querySelectorAll("input, select, button")) expect(classes(node)).toContain("min-h-10");
    for (const node of container.querySelectorAll("textarea")) expect(classes(node)).toContain("min-h-24");
    for (const node of container.querySelectorAll("input, select, textarea, button")) expect(classes(node), node.tagName).toContain("focus-visible:ring-3");
    const grids = Array.from(container.querySelectorAll("[data-pf-profile-fields-grid]"));
    expect(grids).toHaveLength(4);
    for (const grid of grids) expect([classes(grid).includes("grid-cols-1"), classes(grid).includes("sm:grid-cols-2")]).toEqual([true, true]);
    const row = container.querySelector("[data-pf-profile-language-row]");
    expect([classes(row).includes("grid-cols-1"), classes(row).includes("sm:grid-cols-3")]).toEqual([true, true]);
    expect(container.querySelector("[data-pf-profile-language-add]")).toHaveTextContent("Agregar idioma");
    expect(container.querySelectorAll("button")).toHaveLength(3);
    expect(RAW_COLOR.test(Array.from(container.querySelectorAll("[class]")).map(classes).join(" "))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(SOURCE).not.toMatch(/w-\[\d+px\]|overflow-x|w-screen/u);
  });

  it("stays a controlled, form-free and validation-free surface with no side effect or fixture", () => {
    const { container } = renderFields();
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("[role]")).toHaveLength(0);
    expect(container.querySelectorAll('[type="submit"], [type="reset"]')).toHaveLength(0);
    expect(modulesOf(SOURCE)).toEqual(["./model", "./profile-draft"]);
    expect(SOURCE).toMatch(/^"use client";/u);
    for (const forbidden of ["email", "fullName", "userId", "createdAt", "updatedAt", "cv", "auth", "password", "useState", "useReducer", "useEffect", "useRef", "<form", "onSubmit", "submit", "reset", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.", "document.", "window.", "useRouter", "next/navigation", "setTimeout", "setInterval", "Math.random", "Date.now", "prototype-", "profile-draft.test", "parseProfileDraft", "safeParse", "validate"]) {
      expect(SOURCE, `profile-form-fields.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
    expect(SOURCE).not.toMatch(/from "react|from "react-dom/u);
  });
});
