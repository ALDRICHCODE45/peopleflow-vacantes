import { ClipboardList, UserRound } from "lucide-react";
import type { Board, Participation } from "./model";
import type { BoardFilterDimension } from "./board-filter-dimensions";

import { CEFR_LEVELS, EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, SENIORITIES, SENIORITY_LABELS } from "@/features/candidate/model";
import type { LanguageCatalog } from "@/features/languages/model";
export const educationLabels = EDUCATION_LEVEL_LABELS;
const screening = { key: "screening", label: "PREGUNTAS DE FILTRO", icon: ClipboardList };
const profile = { key: "profile", label: "PERFIL DEL CANDIDATO", icon: UserRound };
const noData = { value: "none", label: "Sin dato" };
export const normalizedProfileLabel = (value: string) => value.replace(/\p{White_Space}+/gu, " ").trim();
// Fold per code point (not contextual lowercase: final sigma and ß must coalesce).
// Default Unicode folding keeps dotless i distinct and Cherokee in uppercase.
function valueKey(value: string): string {
  return Array.from(normalizedProfileLabel(value), char => {
    if (char === "ı") return char;
    if (/\p{Script=Cherokee}/u.test(char)) return char.toUpperCase();
    return char.toLowerCase().toUpperCase().toLowerCase();
  }).join("");
}
const experienceOptions = [
  { value: "under_one", label: "Menos de 1 año" }, { value: "one_three", label: "1 a 3 años" },
  { value: "three_five", label: "3 a 5 años" }, { value: "five_plus", label: "5 años o más" },
];
const experienceValue = (years: string | null) => years === null ? "none" : experienceOptions[Number(years) < 1 ? 0 : Number(years) < 3 ? 1 : Number(years) < 5 ? 2 : 3].value;
function textOptions(values: string[]) {
  const labels = new Map<string, string>();
  for (const raw of values) {
    const label = normalizedProfileLabel(raw), value = valueKey(raw);
    if (label && !labels.has(value)) labels.set(value, label);
  }
  return [...labels].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es"));
}
function profileDimension(key: string, label: string, options: BoardFilterDimension<Participation>["options"], values: (item: Participation) => string[], helper = "Datos del perfil al postularse."): BoardFilterDimension<Participation> {
  return {
    key, label, options: [...options, noData],
    presentation: { section: profile, label, placeholder: "Todas las opciones", helper, singular: "opción", plural: "opciones" },
    match: (item, selected) => {
      const actual = values(item).filter(Boolean);
      return (actual.length ? actual : ["none"]).some(value => selected.has(value));
    },
  };
}
function locationOptions(items: Participation[], key: "state" | "municipality") {
  const labels = new Map<string, string>();
  for (const item of items) {
    const location = item.profile.location;
    const reference = location?.[key];
    if (reference && !labels.has(reference.id)) {
      labels.set(reference.id, key === "municipality" && location?.state ? `${reference.name}, ${location.state.name}` : reference.name);
    }
  }
  return [...labels].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es"));
}
export function filterDataDimensions(board: Board, languages: LanguageCatalog["items"] = []): BoardFilterDimension<Participation>[] {
  const items = board.participations;
  return [
    ...board.screening_filters.map((question): BoardFilterDimension<Participation> => ({
      key: `screening:${question.question_id}`, label: question.prompt,
      options: [...question.options.map(option => ({ value: option.id, label: option.label })), { value: "none", label: "Sin respuesta" }],
      presentation: { section: screening, label: question.prompt, placeholder: "Todas las respuestas", helper: "Elige una o varias respuestas.", singular: "respuesta", plural: "respuestas" },
      match: (item, selected) => {
        const answer = item.screening_answers.find(answer => answer.question_id.toLowerCase() === question.question_id.toLowerCase());
        if (!answer) return selected.has("none");
        const option = question.options.find(option => option.id.toLowerCase() === answer.option_id.toLowerCase());
        return !!option && selected.has(option.id);
      },
    })),
    profileDimension("state", "Estado", locationOptions(items, "state"), item => [item.profile.location?.state?.id ?? "none"]),
    profileDimension("municipality", "Municipio", locationOptions(items, "municipality"), item => [item.profile.location?.municipality?.id ?? "none"]),
    profileDimension("skills", "Habilidades", textOptions(items.flatMap(item => item.profile.skills)), item => item.profile.skills.map(valueKey)),
    profileDimension("experience", "Años de experiencia", experienceOptions.filter(option => items.some(item => experienceValue(item.profile.years_of_experience) === option.value)), item => [experienceValue(item.profile.years_of_experience)]),
    profileDimension("seniority", "Seniority", SENIORITIES.map(value => ({ value, label: SENIORITY_LABELS[value] })), item => item.profile.seniority ? [item.profile.seniority] : []),
    {
      ...profileDimension("education", "Nivel de estudios", EDUCATION_LEVELS.map(value => ({ value, label: educationLabels[value] })), () => [], "Coincide con este nivel o uno superior."),
      modifiers: { toggle: { value: "@ongoing", label: "Incluye estudios en curso" } },
      match: (item, selected) => {
        const levels = [...selected].filter(value => !value.startsWith("@"));
        if (!levels.length) return true;
        const { highest_completed, in_progress } = item.profile.education;
        return levels.some(value => {
          if (value === "none") return highest_completed === null && in_progress === null;
          const minimum = EDUCATION_LEVELS.findIndex(level => level === value);
          return minimum >= 0 && (
            (highest_completed !== null && EDUCATION_LEVELS.indexOf(highest_completed) >= minimum) ||
            (selected.has("@ongoing") && in_progress !== null && EDUCATION_LEVELS.indexOf(in_progress) >= minimum));
        });
      },
    },
    {
      ...profileDimension("languages", "Idiomas", languages.filter(language => items.some(item => item.profile.languages.some(value => value.code === language.code))).map(language => ({ value: language.code, label: language.name })), item => item.profile.languages.map(language => language.code), "Cualquiera de los idiomas elegidos, al nivel mínimo indicado."),
      modifiers: { minimum: { label: "Nivel mínimo", options: CEFR_LEVELS.map(level => ({ value: `@min:${level}`, label: level === "native" ? "Nativo" : level })) } },
      match: (item, selected) => {
        const codes = [...selected].filter(value => !value.startsWith("@"));
        if (!codes.length) return true;
        if (!item.profile.languages.length) return selected.has("none");
        const minimum = CEFR_LEVELS.findIndex(level => selected.has(`@min:${level}`));
        return item.profile.languages.some(language => selected.has(language.code) && CEFR_LEVELS.indexOf(language.level) >= minimum);
      },
    },
  ];
}
