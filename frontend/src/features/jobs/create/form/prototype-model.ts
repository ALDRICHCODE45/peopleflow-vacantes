/**
 * Local-only prototype model for the enriched create-vacancy pass.
 *
 * Every value here is exploratory UI state: it feeds the live preview and the
 * local interactions, it is never persisted, and it is deliberately isolated
 * from the write contract. This module therefore declares no imports at all, so
 * no contract, client, or transport symbol can reach it, and the contract form
 * model cannot reach it either.
 *
 * Identifiers stay in English; every catalog label the recruiter reads is in
 * Spanish.
 */

/** CEFR proficiency bands, from the most basic to a fully fluent speaker. */
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** How often the advertised salary is paid. */
export type PayFrequency = "monthly" | "yearly" | "hourly";

/** Employer-paid benefit a recruiter can advertise. */
export type BenefitKey =
  | "health_insurance"
  | "computer_equipment"
  | "flexible_schedule"
  | "remote_stipend"
  | "training_budget"
  | "extra_time_off"
  | "wellness"
  | "annual_bonus";

/** One language a recruiter asks for, with an optional proficiency level. */
export type LanguageRequirement = {
  id: string;
  language: string;
  level: CefrLevel | "";
};

/** One optional screening question, with no answer captured locally. */
export type ScreeningQuestion = {
  id: string;
  prompt: string;
};

/**
 * The whole local-only prototype state: the strategy fields no write request
 * accepts today. The shape is intentionally unrelated to the contract form
 * values, so a field can never be mistaken for a wire field.
 */
export type VacancyPrototypeValues = {
  department: string;
  skills: string[];
  languages: LanguageRequirement[];
  benefits: BenefitKey[];
  payFrequency: PayFrequency | "";
  /**
   * Tokenized rich description that owns rich-text editing. It stays local-only:
   * the contract keeps the derived plain `description`.
   */
  descriptionRich: string;
  requiredRequirements: string;
  preferredRequirements: string;
  screeningQuestions: ScreeningQuestion[];
  closingDate: string;
};

/** A brand-new screen carries no prototype value yet: every field starts empty. */
export const INITIAL_PROTOTYPE_VALUES: VacancyPrototypeValues = {
  department: "",
  skills: [],
  languages: [],
  benefits: [],
  payFrequency: "",
  descriptionRich: "",
  requiredRequirements: "",
  preferredRequirements: "",
  screeningQuestions: [],
  closingDate: "",
};

/** Maximum number of technologies a recruiter can advertise. */
export const MAX_SKILLS = 10;
/** Maximum number of languages a recruiter can require. */
export const MAX_LANGUAGES = 3;
/** Maximum number of screening questions; zero questions is valid. */
export const MAX_SCREENING_QUESTIONS = 3;

/** CEFR bands in ascending order, paired with their Spanish labels. */
export const CEFR_LEVEL_OPTIONS = [
  { value: "A1", label: "Principiante" },
  { value: "A2", label: "Básico" },
  { value: "B1", label: "Intermedio" },
  { value: "B2", label: "Intermedio alto" },
  { value: "C1", label: "Avanzado" },
  { value: "C2", label: "Nativo o bilingüe" },
] as const satisfies ReadonlyArray<{ value: CefrLevel; label: string }>;

/** Pay frequencies with the exact Spanish labels the screen shows. */
export const PAY_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Mensual" },
  { value: "yearly", label: "Anual" },
  { value: "hourly", label: "Por hora" },
] as const satisfies ReadonlyArray<{ value: PayFrequency; label: string }>;

/** Every benefit a recruiter can advertise, with its Spanish label. */
export const BENEFIT_OPTIONS = [
  { value: "health_insurance", label: "Seguro de salud" },
  { value: "computer_equipment", label: "Equipo de cómputo" },
  { value: "flexible_schedule", label: "Horario flexible" },
  { value: "remote_stipend", label: "Ayuda para trabajo remoto" },
  { value: "training_budget", label: "Presupuesto de capacitación" },
  { value: "extra_time_off", label: "Días libres adicionales" },
  { value: "wellness", label: "Bienestar y salud mental" },
  { value: "annual_bonus", label: "Bono anual" },
] as const satisfies ReadonlyArray<{ value: BenefitKey; label: string }>;

/** Company departments, in the order the screen offers them. */
export const DEPARTMENTS = [
  "Ingeniería",
  "Producto",
  "Diseño",
  "Ventas",
  "Marketing",
  "Operaciones",
  "Personas",
  "Finanzas",
  "Soporte al cliente",
] as const;

/** Suggested technologies a recruiter can pick from. */
export const SKILLS = [
  "React",
  "TypeScript",
  "Node.js",
  "Next.js",
  "PostgreSQL",
  "AWS",
  "Docker",
  "Kubernetes",
  "GraphQL",
  "Liderazgo",
  "Comunicación",
  "Product discovery",
] as const;

/** Languages a recruiter can require, in the order the screen offers them. */
export const LANGUAGES = [
  "Español",
  "Inglés",
  "Portugués",
  "Francés",
  "Alemán",
] as const;

/** Fields a language update may change; the identifier always stays the same. */
export type LanguageRequirementPatch = Partial<{
  language: string;
  level: CefrLevel | "";
}>;

/** Field a screening-question update may change; the identifier stays the same. */
export type ScreeningQuestionPatch = Partial<{
  prompt: string;
}>;

/**
 * Appends a caller-provided language. The input array is never mutated, every
 * existing entry keeps its identity and position, and at the limit the original
 * array comes back untouched so the screen cannot exceed it.
 */
export function addLanguageRequirement(
  languages: LanguageRequirement[],
  item: LanguageRequirement,
): LanguageRequirement[] {
  if (languages.length >= MAX_LANGUAGES) return languages;
  return [...languages, item];
}

/**
 * Updates one language by id. Untouched entries keep their identity and order;
 * an unknown id leaves the very same array in place.
 */
export function updateLanguageRequirement(
  languages: LanguageRequirement[],
  id: string,
  patch: LanguageRequirementPatch,
): LanguageRequirement[] {
  const index = languages.findIndex((language) => language.id === id);
  if (index === -1) return languages;
  return languages.map((language, position) => {
    if (position !== index) return language;
    return {
      id: language.id,
      language: patch.language ?? language.language,
      level: patch.level ?? language.level,
    };
  });
}

/**
 * Removes one language by id, keeping the remaining order and identities. An
 * unknown id leaves the very same array in place.
 */
export function removeLanguageRequirement(
  languages: LanguageRequirement[],
  id: string,
): LanguageRequirement[] {
  const index = languages.findIndex((language) => language.id === id);
  if (index === -1) return languages;
  return [...languages.slice(0, index), ...languages.slice(index + 1)];
}

/**
 * Appends a caller-provided screening question. The input array is never
 * mutated, existing questions keep their identity and position, and at the
 * limit the original array comes back untouched.
 */
export function addScreeningQuestion(
  questions: ScreeningQuestion[],
  item: ScreeningQuestion,
): ScreeningQuestion[] {
  if (questions.length >= MAX_SCREENING_QUESTIONS) return questions;
  return [...questions, item];
}

/**
 * Updates one screening question by id. Untouched questions keep their identity
 * and order; an unknown id leaves the very same array in place.
 */
export function updateScreeningQuestion(
  questions: ScreeningQuestion[],
  id: string,
  patch: ScreeningQuestionPatch,
): ScreeningQuestion[] {
  const index = questions.findIndex((question) => question.id === id);
  if (index === -1) return questions;
  return questions.map((question, position) => {
    if (position !== index) return question;
    return {
      id: question.id,
      prompt: patch.prompt ?? question.prompt,
    };
  });
}

/**
 * Removes one screening question by id, keeping the remaining order and
 * identities. An unknown id leaves the very same array in place.
 */
export function removeScreeningQuestion(
  questions: ScreeningQuestion[],
  id: string,
): ScreeningQuestion[] {
  const index = questions.findIndex((question) => question.id === id);
  if (index === -1) return questions;
  return [...questions.slice(0, index), ...questions.slice(index + 1)];
}
