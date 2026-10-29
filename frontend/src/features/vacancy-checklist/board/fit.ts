import type { Participation } from "@/features/pipeline-movement/model";
import { compareFit, evaluateCriterion, summarize, type FitSummary } from "../evaluate";
import type { Criterion, Mark } from "../model";
const total = (counts: FitSummary["required"]) => counts.met + counts.not_met + counts.unknown;
export function fitLine(summary: FitSummary): string {
  return [total(summary.required) && `Obligatorios ${summary.required.met}/${total(summary.required)}`, total(summary.desirable) && `Deseables ${summary.desirable.met}/${total(summary.desirable)}`, (summary.required.unknown + summary.desirable.unknown) && `${summary.required.unknown + summary.desirable.unknown} sin evaluar`].filter(Boolean).join(" · ");
}
export function matchesFit(summary: FitSummary, selected: ReadonlySet<string>): boolean {
  return (selected.has("met") && total(summary.required) > 0 && summary.required.met === total(summary.required)) || (selected.has("unknown") && summary.required.unknown > 0) || (selected.has("not_met") && summary.required.not_met > 0);
}
export function orderByFit(items: Participation[], criteria: Criterion[], marks: Mark[]): Participation[] {
  const summaries = new Map(items.map(item => [item.id, summarize(criteria, item, marks)]));
  return [...items].sort((a, b) => compareFit(summaries.get(a.id)!, summaries.get(b.id)!));
}
export function pendingRequired(criteria: Criterion[], item: Participation, marks: Mark[], stages: string[], target: string): Criterion[] {
  return stages.includes(target) ? criteria.filter(criterion => criterion.importance === "required" && evaluateCriterion(criterion, item, marks.find(mark => mark.participation_id === item.id && mark.criterion_id === criterion.id)).result === "unknown") : [];
}
