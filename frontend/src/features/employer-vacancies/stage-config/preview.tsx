import { Columns3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { normalizeStageName, type PipelineEditorState } from "@/features/jobs/drafts/pipeline/editor-model";
import { StageKindBadge } from "./stage-row";

export function PipelinePreview({ state }: { state: PipelineEditorState }) {
  const column = (stage: PipelineEditorState["stages"][number] | PipelineEditorState["exit"]) => (
    <Card key={stage.key} size="sm" className="w-52 shrink-0">
      <CardHeader>
        <CardTitle><h4 className="break-words">{normalizeStageName(stage.name) || "Sin nombre"}</h4></CardTitle>
        <CardDescription><StageKindBadge kind={stage.kind} /></CardDescription>
      </CardHeader>
      <CardContent><p className="text-xs text-muted-foreground">Sin candidatos todavía</p></CardContent>
    </Card>
  );
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 id="pipeline-preview-heading" className="flex items-center gap-2 font-heading text-base font-semibold"><Columns3 aria-hidden="true" className="size-4" />Vista previa</h3>
      <div role="region" aria-labelledby="pipeline-preview-heading" tabIndex={0} className="flex gap-4 overflow-x-auto rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div role="list" aria-label="Orden de las columnas" className="flex gap-3">
          {state.stages.map(stage => <div role="listitem" key={stage.key} className="flex">{column(stage)}</div>)}
        </div>
        <Separator orientation="vertical" className="h-auto self-stretch" />
        {column(state.exit)}
      </div>
    </section>
  );
}
