import { EDUCATION_LEVEL_LABELS, SENIORITY_LABELS } from "@/features/candidate/model";
import type { DraftPostBody } from "@/features/jobs/drafts/fields";
import type { LocationRead, LocationWrite } from "@/features/geo/model";
import { criterionSchema, normalizeSkillName, type Criterion } from "./model";

export type SuggestionFields = Partial<Pick<DraftPostBody["fields"], "min_years_of_experience" | "seniority" | "min_education_level" | "accepts_in_progress_education" | "languages" | "skills" | "work_mode" | "required_requirements" | "preferred_requirements">> & { location?: LocationRead | LocationWrite };
export type SuggestionQuestion = { id: string; type: string; prompt: string; correct_option_id?: string };
const boundedLabel = (value: string) => [...value.trim()].slice(0, 200).join("");
/** Draft requirements are nullable plain/Markdown strings, not rich description JSON. */
export function suggestCriteria(fields: SuggestionFields, screeningQuestions: readonly SuggestionQuestion[], languageName: (code: string) => string = code => code): Criterion[] {
  const criteria: Criterion[] = [];
  const seen = new Set<string>();
  const add = (kind: Criterion["kind"], params: unknown, label: string, importance: Criterion["importance"] = "required") => {
    if (criteria.length >= 50) return;
    const parsed = criterionSchema.safeParse({ id: crypto.randomUUID(), label: boundedLabel(label), importance, kind, params });
    if (!parsed.success) return;
    const key = parsed.data.kind === "skill" ? `skill:${normalizeSkillName(parsed.data.params.name)}` : `${kind}:${JSON.stringify(params)}`;
    if (kind !== "manual" && seen.has(key)) return;
    seen.add(key); criteria.push(parsed.data);
  };
  if (fields.min_years_of_experience !== null && fields.min_years_of_experience !== undefined) add("min_years_experience", { min: fields.min_years_of_experience }, `Al menos ${fields.min_years_of_experience} años de experiencia`);
  if (fields.seniority) add("seniority", { accepted: [fields.seniority] }, `Nivel ${SENIORITY_LABELS[fields.seniority]}`);
  if (fields.min_education_level) add("education", { min_level: fields.min_education_level, accepts_in_progress: fields.accepts_in_progress_education ?? false }, `Escolaridad mínima: ${EDUCATION_LEVEL_LABELS[fields.min_education_level]}${fields.accepts_in_progress_education ? " (acepta en curso)" : ""}`);
  for (const language of fields.languages ?? []) add("language", language, `Idioma: ${languageName(language.code)} · mínimo ${language.min_level}`);
  for (const skill of fields.skills ?? []) add("skill", { name: skill.trim() }, `Habilidad: ${skill.trim()}`);
  if ((fields.work_mode === "onsite" || fields.work_mode === "hybrid") && fields.location) {
    const { country, state } = fields.location;
    const countryId = typeof country === "string" ? country : country.id;
    const stateId = typeof state === "string" ? state : state?.id;
    const countryLabel = typeof country === "string" ? country : country.name;
    const stateLabel = typeof state === "string" ? state : state?.name;
    add("location", { country: countryId, states: stateId ? [stateId] : [] }, `Ubicación: ${countryLabel}${stateLabel ? ` · ${stateLabel}` : ""}`);
  }
  for (const question of screeningQuestions) if (question.type === "single_choice_evaluated" && question.correct_option_id) add("screening_answer", { question_id: question.id, accepted_option_ids: [question.correct_option_id] }, question.prompt);
  for (const [text, importance] of [[fields.required_requirements, "required"], [fields.preferred_requirements, "desirable"]] as const) {
    for (const line of (text ?? "").split(/\r?\n/)) {
      const label = line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/u, "").trim();
      if (label) add("manual", {}, label, importance);
    }
  }
  return criteria;
}
