import type { PipelineImpactPreview } from "@/features/jobs/drafts/pipeline/client";
import type { EditorPipeline } from "@/features/jobs/drafts/pipeline/editor-model";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import { plural } from "@/features/employer-vacancies/pipeline-board";

/** The shared confirmation owns the sole scrolling details slot (§13.8/§18). */
export function ImpactDetails({ preview, baseline }: { preview: PipelineImpactPreview; baseline: EditorPipeline }) {
  const name = (id: string) => preview.stages.find(stage => stage.id === id)?.name ?? baseline.stages.find(stage => stage.id === id)?.name ?? "Columna no disponible";
  const groups = [
    { title: "No aplica por cambio de proceso", rows: preview.not_applicable.map(entry => ({ key: `${entry.participation_id}:${entry.stage_id}`, text: `${entry.candidate.full_name} → ${name(entry.stage_id)}` })) },
    { title: "Al recuperarse elegirán columna", rows: preview.recovery_reassigned.map(entry => ({ key: entry.participation_id, text: `${entry.candidate.full_name} → ${name(entry.retired_stage_id)} → ${name(entry.default_stage_id)}` })) },
  ];
  return <>{groups.filter(group => group.rows.length).map(group => <Card key={group.title} size="sm" className="shrink-0">
    <CardHeader><CardTitle><h4>{group.title}</h4></CardTitle><CardAction><span className="text-xs tabular-nums text-muted-foreground">{plural(group.rows.length, "cambio", "cambios")}</span></CardAction></CardHeader>
    <CardContent><ItemGroup className="gap-0">{group.rows.map(row => <Item key={row.key} size="sm"><ItemContent className="min-w-0 break-words">{row.text}</ItemContent></Item>)}</ItemGroup></CardContent>
  </Card>)}</>;
}
