import { CEFR_LEVELS, EDUCATION_LEVELS } from "@/features/candidate/model";
import type { Participation } from "@/features/pipeline-movement/model";
import { normalizeSkillName, type Criterion, type Mark } from "./model";

export type EvaluationParticipation = Pick<Participation, "id" | "profile" | "screening_answers">;
export type Evaluation = { result: "met" | "not_met" | "unknown"; source: "mark" | "auto" | "none" };
export type FitSummary = Record<Criterion["importance"], Record<Evaluation["result"], number>>;
export function evaluateCriterion(criterion: Criterion, participation: EvaluationParticipation, mark?: Mark): Evaluation {
  if (mark) return { result: mark.verdict, source: "mark" };
  const { profile, screening_answers } = participation;
  const auto = (result: Evaluation["result"]): Evaluation => ({ result, source: "auto" });
  const verdict = (met: boolean) => auto(met ? "met" : "not_met");
  switch (criterion.kind) {
    case "manual": return { result: "unknown", source: "none" };
    case "min_years_experience": return profile.years_of_experience === null ? auto("unknown") : verdict(Number(profile.years_of_experience) >= Number(criterion.params.min));
    case "seniority": return profile.seniority === null ? auto("unknown") : verdict(criterion.params.accepted.includes(profile.seniority));
    case "education": {
      const { highest_completed, in_progress } = profile.education;
      const min = EDUCATION_LEVELS.indexOf(criterion.params.min_level);
      if (highest_completed !== null && EDUCATION_LEVELS.indexOf(highest_completed) >= min) return auto("met");
      if (criterion.params.accepts_in_progress && in_progress !== null && EDUCATION_LEVELS.indexOf(in_progress) >= min) return auto("met");
      return auto(highest_completed === null && in_progress === null ? "unknown" : "not_met");
    }
    case "language": {
      const language = profile.languages.find(item => item.code === criterion.params.code);
      return language ? verdict(CEFR_LEVELS.indexOf(language.level) >= CEFR_LEVELS.indexOf(criterion.params.min_level)) : auto(profile.languages.length ? "not_met" : "unknown");
    }
    case "skill": return auto(profile.skills.some(skill => normalizeSkillName(skill) === normalizeSkillName(criterion.params.name)) ? "met" : "unknown");
    case "location": {
      const location = profile.location;
      if (!location?.country) return auto("unknown");
      if (location.country.id !== criterion.params.country) return auto("not_met");
      if (!criterion.params.states.length) return auto("met");
      return location.state ? verdict(criterion.params.states.includes(location.state.id)) : auto("unknown");
    }
    case "screening_answer": {
      const answer = screening_answers.find(item => item.question_id.toLowerCase() === criterion.params.question_id.toLowerCase());
      return answer ? verdict(criterion.params.accepted_option_ids.some(id => id.toLowerCase() === answer.option_id.toLowerCase())) : auto("unknown");
    }
  }
}
export function summarize(criteria: readonly Criterion[], participation: EvaluationParticipation, marks: readonly Mark[]): FitSummary {
  const summary: FitSummary = { required: { met: 0, not_met: 0, unknown: 0 }, desirable: { met: 0, not_met: 0, unknown: 0 } };
  for (const criterion of criteria) {
    const mark = marks.find(item => item.participation_id === participation.id && item.criterion_id === criterion.id);
    summary[criterion.importance][evaluateCriterion(criterion, participation, mark).result]++;
  }
  return summary;
}
/** Returns zero for ties: use a stable sort to preserve the board's original order. */
export function compareFit(a: FitSummary, b: FitSummary): number {
  return b.required.met - a.required.met || a.required.not_met - b.required.not_met || b.desirable.met - a.desirable.met || a.required.unknown - b.required.unknown;
}
export function resultLabel(result: Evaluation["result"]): string {
  return { met: "cumple", not_met: "no cumple", unknown: "sin evaluar" }[result];
}
/** No source is rendered for an unmarked manual criterion. */
export function sourceLabel(evaluation: Evaluation, criterion: Criterion): string | null {
  return evaluation.source === "none" ? null : evaluation.source === "mark" ? "reclutador" : criterion.kind === "screening_answer" ? "respuesta" : "perfil";
}
