"use client";

import { CEFR_LEVELS, CEFR_LEVEL_LABELS, EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, SALARY_PERIOD_LABELS, SALARY_PERIODS } from "./model";
import type { CefrLevel } from "./model";
import type { CandidateLanguageDraft, CandidateProfileDraft, ProfileDraftIssue } from "./profile-draft";

/**
 * Controlled, presentation-only editor for the 19 editable profile draft fields.
 * It renders the received `draft` and the received `issues` and emits a complete
 * new draft through `onChange` on every edit: no state, form, submission,
 * validation, fixture, network, storage, router, timer, or randomness lives here.
 * CDP-07B2 owns the form element, local orchestration and the no-save messaging.
 */
export type ProfileFormFieldsProps = Readonly<{
  draft: CandidateProfileDraft;
  issues: readonly ProfileDraftIssue[];
  onChange: (next: CandidateProfileDraft) => void;
}>;

/** Every draft key a scalar control owns; languages render as indexed rows. */
type ScalarPath = Exclude<keyof CandidateProfileDraft, "languages">;
/** One selectable option: the exact closed-vocabulary value plus its Spanish label. */
type Option = Readonly<{ value: string; label: string }>;
/** One labelled scalar control with its schema-aligned native metadata. */
type ScalarSpec = Readonly<{
  path: ScalarPath; label: string; type?: "text" | "tel" | "url" | "date" | "number";
  min?: number; max?: number; step?: number; maxLength?: number; hint?: string; multiline?: boolean; options?: readonly Option[];
}>;
/** Blank first option of the three closed-vocabulary selects and of a language level. */
const BLANK = "Sin especificar";
const optionsOf = <T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>): readonly Option[] =>
  [{ value: "", label: BLANK }, ...values.map((value) => ({ value, label: labels[value] }))];
const CEFR_OPTIONS = optionsOf(CEFR_LEVELS, CEFR_LEVEL_LABELS);

/** The five semantic groups in approved order: four scalar groups plus languages. */
const GROUPS: readonly Readonly<{ slug: string; legend: string; fields: readonly ScalarSpec[] }>[] = [
  { slug: "professional", legend: "Perfil profesional", fields: [
    { path: "professionalTitle", label: "Título profesional", maxLength: 120 },
    { path: "currentCompany", label: "Empresa actual o última", maxLength: 120 },
    { path: "yearsOfExperience", label: "Años de experiencia", type: "number", min: 0, max: 60, step: 1, hint: "Número entero entre 0 y 60." },
    { path: "summary", label: "Resumen profesional", multiline: true, maxLength: 2000, hint: "Máximo 2000 caracteres." },
  ] },
  { slug: "contact", legend: "Contacto y ubicación", fields: [
    { path: "phone", label: "Teléfono", type: "tel", maxLength: 30 },
    { path: "linkedinUrl", label: "Perfil de LinkedIn", type: "url", maxLength: 300 },
    { path: "portfolioUrl", label: "Portafolio o sitio web", type: "url", maxLength: 300 },
    { path: "birthDate", label: "Fecha de nacimiento", type: "date" },
    { path: "city", label: "Ciudad de residencia", maxLength: 120 },
    { path: "country", label: "País", maxLength: 120 },
  ] },
  { slug: "education", legend: "Educación y habilidades", fields: [
    { path: "educationLevel", label: "Nivel máximo de estudios", options: optionsOf(EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS) },
    { path: "fieldOfStudy", label: "Campo de estudio", maxLength: 120 },
    { path: "skills", label: "Habilidades", multiline: true, hint: "Separa las habilidades con comas. Hasta 60 habilidades." },
  ] },
  { slug: "compensation", legend: "Expectativas salariales", fields: [
    { path: "currentSalaryGross", label: "Salario bruto actual", type: "number", min: 0, max: 100_000_000, step: 1 },
    { path: "currentSalaryNet", label: "Salario neto actual", type: "number", min: 0, max: 100_000_000, step: 1 },
    { path: "expectedSalary", label: "Salario esperado", type: "number", min: 0, max: 100_000_000, step: 1 },
    { path: "salaryCurrency", label: "Moneda", maxLength: 3, hint: "Código de 3 letras, por ejemplo MXN." },
    { path: "expectedSalaryPeriod", label: "Periodo del salario esperado", options: optionsOf(SALARY_PERIODS, SALARY_PERIOD_LABELS) },
  ] },
];

/** Token-only paint, a 40px target baseline and a visible focus ring, shared by all controls. */
const FOCUS = "focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50";
const CONTROL = `min-h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground ${FOCUS}`;
const TEXTAREA = `min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground ${FOCUS}`;
const BUTTON = `inline-flex min-h-10 items-center justify-center rounded-md border border-input px-3 text-sm font-medium text-foreground ${FOCUS}`;
const LABEL = "text-[12.5px] font-medium text-foreground";
const HINT = "text-[12.5px] text-muted-foreground";
const ERROR = "text-[12.5px] font-medium text-destructive";
const LEGEND = "text-sm font-semibold text-foreground";
const GROUP = "flex flex-col gap-3 rounded-lg border border-border p-4";
const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2";
const ROW = "grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end";
const STACK = "flex flex-col gap-1.5";

/** One labelled scalar, textarea, or select control with its explicit label and error wiring. */
function ScalarField({ spec, value, error, onChange }: Readonly<{ spec: ScalarSpec; value: string; error: string | null; onChange: (value: string) => void }>) {
  const id = `profile-${spec.path}`;
  const describedBy = [spec.hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter((token) => token !== null).join(" ");
  const shared = { id, value, className: spec.multiline ? TEXTAREA : CONTROL, "data-pf-profile-field": spec.path, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy === "" ? undefined : describedBy };
  const handle = (event: { readonly target: { readonly value: string } }): void => onChange(event.target.value);
  return (
    <div className={STACK}>
      <label htmlFor={id} className={LABEL}>{spec.label}</label>
      {spec.options !== undefined
        ? <select {...shared} onChange={handle}>{spec.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : spec.multiline
          ? <textarea {...shared} maxLength={spec.maxLength} onChange={handle} />
          : <input {...shared} type={spec.type ?? "text"} min={spec.min} max={spec.max} step={spec.step} maxLength={spec.maxLength} onChange={handle} />}
      {spec.hint ? <p id={`${id}-hint`} className={HINT}>{spec.hint}</p> : null}
      {error ? <p id={`${id}-error`} className={ERROR}>{error}</p> : null}
    </div>
  );
}

/** The controlled field editor: every rendered value and message comes from props. */
export function ProfileFormFields({ draft, issues, onChange }: ProfileFormFieldsProps) {
  const byPath = new Map<string, string>();
  for (const issue of issues) if (!byPath.has(issue.path)) byPath.set(issue.path, issue.message);
  const errorFor = (path: string): string | null => byPath.get(path) ?? null;
  const languagesError = errorFor("languages");
  /** Immutable scalar edit: a shallow clone carrying the one changed key. */
  const updateScalar = (path: ScalarPath, value: string): void => { onChange({ ...draft, [path]: value }); };
  /** Immutable row edit: only the addressed row is cloned, the rest are reused. */
  const updateLanguage = (index: number, patch: Partial<CandidateLanguageDraft>): void => {
    onChange({ ...draft, languages: draft.languages.map((row, position) => (position === index ? { ...row, ...patch } : row)) });
  };
  const addLanguage = (): void => { onChange({ ...draft, languages: [...draft.languages, { name: "", level: "" }] }); };
  const removeLanguage = (index: number): void => { onChange({ ...draft, languages: draft.languages.filter((_, position) => position !== index) }); };
  /** One indexed language row: name, exact CEFR level, and its positional remove action. */
  const languageRow = (row: CandidateLanguageDraft, index: number) => {
    const nameId = `profile-language-${index}-name`;
    const levelId = `profile-language-${index}-level`;
    const nameError = errorFor(`languages.${index}.name`);
    const levelError = errorFor(`languages.${index}.level`);
    return (
      <div key={index} data-pf-profile-language-row={index} className={ROW}>
        <div className={STACK}>
          <label htmlFor={nameId} className={LABEL}>{`Nombre del idioma ${index + 1}`}</label>
          <input id={nameId} data-pf-profile-language-name type="text" maxLength={60} value={row.name} className={CONTROL} aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${nameId}-error` : undefined} onChange={(event) => updateLanguage(index, { name: event.target.value })} />
          {nameError ? <p id={`${nameId}-error`} className={ERROR}>{nameError}</p> : null}
        </div>
        <div className={STACK}>
          <label htmlFor={levelId} className={LABEL}>{`Nivel del idioma ${index + 1}`}</label>
          <select id={levelId} data-pf-profile-language-level value={row.level} className={CONTROL} aria-invalid={levelError ? true : undefined} aria-describedby={levelError ? `${levelId}-error` : undefined} onChange={(event) => updateLanguage(index, { level: event.target.value as "" | CefrLevel })}>
            {CEFR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {levelError ? <p id={`${levelId}-error`} className={ERROR}>{levelError}</p> : null}
        </div>
        <button type="button" data-pf-profile-language-remove onClick={() => removeLanguage(index)} className={BUTTON}>{`Quitar idioma ${index + 1}`}</button>
      </div>
    );
  };
  return (
    <div data-pf-profile-fields className="flex flex-col gap-6">
      {GROUPS.map((group) => (
        <fieldset key={group.slug} data-pf-profile-group={group.slug} className={GROUP}>
          <legend className={LEGEND}>{group.legend}</legend>
          <div data-pf-profile-fields-grid className={GRID}>
            {group.fields.map((spec) => <ScalarField key={spec.path} spec={spec} value={draft[spec.path]} error={errorFor(spec.path)} onChange={(value) => updateScalar(spec.path, value)} />)}
          </div>
        </fieldset>
      ))}
      <fieldset data-pf-profile-group="languages" data-pf-profile-field="languages" className={GROUP} aria-describedby={languagesError ? "profile-languages-error" : undefined}>
        <legend className={LEGEND}>Idiomas</legend>
        {languagesError ? <p id="profile-languages-error" className={ERROR}>{languagesError}</p> : null}
        {draft.languages.map(languageRow)}
        <button type="button" data-pf-profile-language-add onClick={addLanguage} className={`${BUTTON} self-start`}>Agregar idioma</button>
      </fieldset>
    </div>
  );
}
