import type { Participation } from "@/features/pipeline-movement/model";
import { compareFit, evaluateCriterion, sourceLabel, summarize } from "../evaluate";
import type { Checklist, Mark } from "../model";

/** Deliberate export allowlist: never retain contact, CV or original profile data. */
export function buildComparison(checklist: Checklist, marks: readonly Mark[], participations: readonly Participation[], ids: readonly string[]) {
  const selected = new Set(ids);
  const candidates = participations.filter(p => selected.has(p.id)).map(p => ({
    id: p.id, name: p.candidate.full_name, stageId: p.stage_id,
    summary: summarize(checklist.criteria, p, marks),
  })).sort((a, b) => compareFit(a.summary, b.summary));
  const groups = (["required", "desirable"] as const).map(importance => ({
    label: importance === "required" ? "Obligatorios" : "Deseables",
    rows: checklist.criteria.filter(c => c.importance === importance).map(criterion => ({
      id: criterion.id, label: criterion.label,
      cells: candidates.map(candidate => {
        const p = participations.find(p => p.id === candidate.id)!;
        const mark = marks.find(m => m.participation_id === p.id && m.criterion_id === criterion.id);
        const evaluation = evaluateCriterion(criterion, p, mark);
        return { result: evaluation.result, source: sourceLabel(evaluation, criterion), note: mark?.note ?? null };
      }),
    })),
  })).filter(group => group.rows.length);
  return { candidates, groups, invalidIds: [...selected].filter(id => !participations.some(p => p.id === id)) };
}
export type Comparison = ReturnType<typeof buildComparison>;
export type StageNames = Readonly<Record<string, string>>;
