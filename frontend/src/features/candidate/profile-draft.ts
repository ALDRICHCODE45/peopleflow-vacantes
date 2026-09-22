import { EDUCATION_LEVELS, SALARY_PERIODS, candidateProfileSchema } from "./model";
import type { CandidateProfile, CefrLevel, EducationLevel, SalaryPeriod } from "./model";

/**
 * Pure, React-free adapter between a validated `CandidateProfile` and the flat
 * string draft the local `/candidato/perfil` form edits. It imports only `./model`,
 * reaches no network, storage, router, clock, or randomness, never mutates its
 * arguments, and carries `createdAt`/`updatedAt` over from the validated baseline.
 */
/** One editable language row; `""` means "no level chosen yet". */
export interface CandidateLanguageDraft { name: string; level: "" | CefrLevel }
/** Every editable profile field as a form-safe string; `""` means "unset". */
export interface CandidateProfileDraft {
  phone: string; linkedinUrl: string; portfolioUrl: string; professionalTitle: string; currentCompany: string;
  yearsOfExperience: string; summary: string; birthDate: string; city: string; country: string;
  educationLevel: "" | EducationLevel; fieldOfStudy: string; skills: string;
  currentSalaryGross: string; currentSalaryNet: string; expectedSalary: string; salaryCurrency: string;
  expectedSalaryPeriod: "" | SalaryPeriod; languages: readonly CandidateLanguageDraft[];
}
/** One failing draft field, addressed by a stable path such as `languages.0.name`. */
export interface ProfileDraftIssue { path: string; message: string }
/** Discriminated outcome: the schema output, or every field issue found. */
export type ProfileDraftParseResult =
  | { ok: true; profile: CandidateProfile }
  | { ok: false; issues: readonly ProfileDraftIssue[] };

/** Canonical report order, mirroring the `candidateProfileSchema` shape order. */
const FIELD_ORDER = ["phone", "linkedinUrl", "portfolioUrl", "professionalTitle", "currentCompany", "yearsOfExperience", "summary", "birthDate", "city", "country", "educationLevel", "fieldOfStudy", "skills", "currentSalaryGross", "currentSalaryNet", "expectedSalary", "salaryCurrency", "expectedSalaryPeriod", "languages"] as const;
/** Spanish noun phrase and integer verb per field, composed into messages. */
const FIELDS: Readonly<Record<string, { of: string; verb?: string }>> = {
  phone: { of: "el teléfono" },
  linkedinUrl: { of: "la URL de LinkedIn" },
  portfolioUrl: { of: "la URL del portafolio" },
  professionalTitle: { of: "el título profesional" },
  currentCompany: { of: "la empresa actual" },
  yearsOfExperience: { of: "los años de experiencia", verb: "deben" },
  summary: { of: "el resumen" },
  city: { of: "la ciudad" },
  country: { of: "el país" },
  fieldOfStudy: { of: "el campo de estudio" },
  currentSalaryGross: { of: "el salario bruto actual", verb: "debe" },
  currentSalaryNet: { of: "el salario neto actual", verb: "debe" },
  expectedSalary: { of: "el salario esperado", verb: "debe" },
};
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
type AddIssue = (path: string, message: string) => void;

/** Deterministically maps a validated profile onto the editable draft. */
export function profileToDraft(profile: CandidateProfile): CandidateProfileDraft {
  const text = (value: string | null): string => value ?? "";
  const integer = (value: number | null): string => (value === null ? "" : String(value));
  return {
    phone: text(profile.phone), linkedinUrl: text(profile.linkedinUrl), portfolioUrl: text(profile.portfolioUrl),
    professionalTitle: text(profile.professionalTitle), currentCompany: text(profile.currentCompany),
    yearsOfExperience: integer(profile.yearsOfExperience), summary: text(profile.summary), birthDate: text(profile.birthDate),
    city: text(profile.city), country: text(profile.country), educationLevel: profile.educationLevel ?? "",
    fieldOfStudy: text(profile.fieldOfStudy), skills: profile.skills.join(", "),
    currentSalaryGross: integer(profile.currentSalaryGross), currentSalaryNet: integer(profile.currentSalaryNet),
    expectedSalary: integer(profile.expectedSalary), salaryCurrency: profile.salaryCurrency,
    expectedSalaryPeriod: profile.expectedSalaryPeriod ?? "",
    languages: profile.languages.map(({ name, level }) => ({ name, level })),
  };
}

/** Trims a text field and maps a blank value to `null`. */
function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Accepts plain base-10 integer strings only: no sign, decimal, or exponent notation. */
function optionalInteger(value: string, path: string, add: AddIssue): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/u.test(trimmed)) {
    add(path, `${capitalize(FIELDS[path].of)} ${FIELDS[path].verb} ser un número entero sin decimales.`);
    return null;
  }
  return Number(trimmed);
}

/** Keeps an exact closed-vocabulary value or `""`; never re-cases it. */
function optionalEnum<T extends string>(value: string, allowed: readonly T[], path: string, add: AddIssue, message: string): T | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if ((allowed as readonly string[]).includes(trimmed)) return trimmed as T;
  add(path, message);
  return null;
}

/** Uppercases the currency, then requires exactly three letters. */
function readCurrency(value: string, add: AddIssue): string {
  const currency = value.trim().toUpperCase();
  if (currency === "") add("salaryCurrency", "La moneda del salario es obligatoria.");
  else if (!/^[A-Z]{3}$/u.test(currency)) add("salaryCurrency", "La moneda debe ser un código de 3 letras, por ejemplo MXN.");
  return currency;
}

/** Splits the comma/newline skill list; trimming, deduping, and lowercasing stay in the shared schema. */
function splitSkills(value: string): string[] {
  return value.split(/[,\n]/u).filter((segment) => segment !== "");
}

/** Drops blank rows, flags partial ones, and hands completed rows to the schema. */
function readLanguages(rows: readonly CandidateLanguageDraft[], add: AddIssue): { name: string; level: CefrLevel }[] {
  const languages: { name: string; level: CefrLevel }[] = [];
  rows.forEach((row, index) => {
    const name = row.name.trim();
    const level = row.level.trim() as "" | CefrLevel;
    if (name === "" && level === "") return;
    const nameValid = name !== "" && name.length <= 60;
    if (name === "") add(`languages.${index}.name`, "El nombre del idioma es obligatorio.");
    else if (name.length > 60) add(`languages.${index}.name`, "El nombre del idioma debe tener como máximo 60 caracteres.");
    if (level === "") add(`languages.${index}.level`, "Selecciona el nivel del idioma.");
    if (nameValid && level !== "") languages.push({ name, level });
  });
  return languages;
}

/** Minimal structural view of a schema issue, so this module needs no zod import. */
interface SchemaIssue {
  code: string; message: string; path: readonly (string | number)[];
  validation?: unknown; minimum?: unknown; maximum?: unknown;
}

/** Translates one schema issue into its Spanish, aria-ready counterpart. */
function schemaIssue(issue: SchemaIssue): ProfileDraftIssue {
  const root = String(issue.path[0] ?? "");
  const index = String(issue.path[1] ?? "");
  const field = FIELDS[root];
  if (root === "skills") {
    return issue.path.length === 1
      ? { path: "skills", message: "Puedes registrar hasta 60 habilidades." }
      : { path: "skills", message: "Cada habilidad debe tener como máximo 60 caracteres." };
  }
  if (root === "languages") {
    if (issue.path.length === 1) return { path: "languages", message: "Puedes registrar hasta 20 idiomas." };
    if (String(issue.path[2]) === "level") return { path: `languages.${index}.level`, message: "El nivel del idioma debe ser uno de A1, A2, B1, B2, C1 o C2." };
    if (issue.message.startsWith("duplicate language: ")) return { path: `languages.${index}.name`, message: `El idioma "${issue.message.replace("duplicate language: ", "")}" ya está registrado.` };
    return { path: `languages.${index}.name`, message: "El nombre del idioma debe tener entre 1 y 60 caracteres." };
  }
  if (root === "birthDate") return { path: "birthDate", message: "La fecha de nacimiento no es una fecha válida (usa el formato AAAA-MM-DD)." };
  if (root === "salaryCurrency") return { path: "salaryCurrency", message: "La moneda del salario es obligatoria." };
  if (root === "educationLevel") return { path: root, message: "Selecciona una opción válida para el nivel educativo." };
  if (root === "expectedSalaryPeriod") return { path: root, message: "Selecciona una opción válida para el periodo del salario esperado." };
  if (field?.verb) {
    return issue.code === "too_small"
      ? { path: root, message: `${capitalize(field.of)} ${field.verb} ser un número entero sin decimales.` }
      : { path: root, message: `El máximo para ${field.of} es ${issue.maximum}.` };
  }
  const label = capitalize(field?.of ?? "el campo");
  if (issue.validation === "url") return { path: root, message: `${label} no es una URL válida.` };
  const bound = issue.code === "too_small" ? issue.minimum : issue.maximum;
  return { path: root, message: `${label} debe tener ${issue.code === "too_small" ? "al menos" : "como máximo"} ${bound} caracteres.` };
}

/** Canonical order: schema field order, then numeric index, then path text. */
function compareIssues(left: ProfileDraftIssue, right: ProfileDraftIssue): number {
  const root = (issue: ProfileDraftIssue): (typeof FIELD_ORDER)[number] => String(issue.path.split(".")[0]) as (typeof FIELD_ORDER)[number];
  const byField = FIELD_ORDER.indexOf(root(left)) - FIELD_ORDER.indexOf(root(right));
  return byField !== 0 ? byField : left.path.localeCompare(right.path, "en", { numeric: true });
}

/** Parses an edited draft into a validated profile; it never throws. */
export function parseProfileDraft(draft: CandidateProfileDraft, baseline: CandidateProfile): ProfileDraftParseResult {
  const found = new Map<string, string>();
  const add: AddIssue = (path, message) => {
    if (!found.has(path)) found.set(path, message);
  };
  const enumMessages = {
    educationLevel: "Selecciona una opción válida para el nivel educativo.",
    expectedSalaryPeriod: "Selecciona una opción válida para el periodo del salario esperado.",
  };
  const candidate = {
    phone: optionalText(draft.phone), linkedinUrl: optionalText(draft.linkedinUrl), portfolioUrl: optionalText(draft.portfolioUrl),
    professionalTitle: optionalText(draft.professionalTitle), currentCompany: optionalText(draft.currentCompany),
    yearsOfExperience: optionalInteger(draft.yearsOfExperience, "yearsOfExperience", add),
    summary: optionalText(draft.summary), birthDate: optionalText(draft.birthDate), city: optionalText(draft.city),
    country: optionalText(draft.country), fieldOfStudy: optionalText(draft.fieldOfStudy), skills: splitSkills(draft.skills),
    educationLevel: optionalEnum(draft.educationLevel, EDUCATION_LEVELS, "educationLevel", add, enumMessages.educationLevel),
    currentSalaryGross: optionalInteger(draft.currentSalaryGross, "currentSalaryGross", add),
    currentSalaryNet: optionalInteger(draft.currentSalaryNet, "currentSalaryNet", add),
    expectedSalary: optionalInteger(draft.expectedSalary, "expectedSalary", add),
    salaryCurrency: readCurrency(draft.salaryCurrency, add),
    expectedSalaryPeriod: optionalEnum(draft.expectedSalaryPeriod, SALARY_PERIODS, "expectedSalaryPeriod", add, enumMessages.expectedSalaryPeriod),
    languages: readLanguages(draft.languages, add),
    createdAt: baseline.createdAt,
    updatedAt: baseline.updatedAt,
  };
  const parsed = candidateProfileSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const mapped = schemaIssue(issue);
      if (!found.has(mapped.path)) found.set(mapped.path, mapped.message);
    }
  }
  const issues = [...found].map(([path, message]) => ({ path, message })).sort(compareIssues);
  return parsed.success && issues.length === 0 ? { ok: true, profile: parsed.data } : { ok: false, issues };
}
