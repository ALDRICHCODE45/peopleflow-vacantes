import { ClipboardList, UserRound } from "lucide-react";
import type { Board, Participation } from "./model";
import type { BoardFilterDimension } from "./board-filter-dimensions";

export const educationLabels = { high_school: "Preparatoria", bachelor: "Licenciatura", master: "Maestría", phd: "Doctorado" };
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
const experienceValue = (years: number | null) => years === null ? "none" : experienceOptions[years < 1 ? 0 : years < 3 ? 1 : years < 5 ? 2 : 3].value;
function textOptions(values: string[]) {
  const labels = new Map<string, string>();
  for (const raw of values) {
    const label = normalizedProfileLabel(raw), value = valueKey(raw);
    if (label && !labels.has(value)) labels.set(value, label);
  }
  return [...labels].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es"));
}
function profileDimension(key: string, label: string, options: BoardFilterDimension<Participation>["options"], values: (item: Participation) => string[]): BoardFilterDimension<Participation> {
  return {
    key, label, options: [...options, noData],
    presentation: { section: profile, label, placeholder: "Todas las opciones", helper: "Datos del perfil al postularse.", singular: "opción", plural: "opciones" },
    match: (item, selected) => {
      const actual = values(item).filter(Boolean);
      return (actual.length ? actual : ["none"]).some(value => selected.has(value));
    },
  };
}
export function filterDataDimensions(board: Board): BoardFilterDimension<Participation>[] {
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
    profileDimension("city", "Ciudad", textOptions(items.flatMap(item => item.profile.city === null ? [] : [item.profile.city])), item => item.profile.city === null ? [] : [valueKey(item.profile.city)]),
    profileDimension("skills", "Habilidades", textOptions(items.flatMap(item => item.profile.skills)), item => item.profile.skills.map(valueKey)),
    profileDimension("experience", "Años de experiencia", experienceOptions.filter(option => items.some(item => experienceValue(item.profile.years_of_experience) === option.value)), item => [experienceValue(item.profile.years_of_experience)]),
    profileDimension("education", "Nivel de estudios", Object.entries(educationLabels).filter(([value]) => items.some(item => item.profile.education_level === value)).map(([value, label]) => ({ value, label })), item => item.profile.education_level === null ? [] : [item.profile.education_level]),
  ];
}
