"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { loadDraftForEditAction, type DraftEditFailureReason, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { PipelineStageEditor } from "./stage-config/editor";
import { PipelineEditorSkeleton } from "./stage-config/loading";

function pipelineLoadReason(reason: string): DraftEditFailureReason {
  switch (reason) {
    case "unauthenticated": case "forbidden": case "not_found": case "company_inactive": case "company_not_active":
    case "no_response": case "server_error": case "unrecognized_response": return reason;
    default: return "unrecognized_response";
  }
}

/** Owns the single header and starts both independent private reads on page entry. */
export function DraftPipelineState({ draftId }: { draftId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<{ id: string; result: DraftEditResult } | null>(null);
  const [config, setConfig] = useState<{ id: string; result: DraftPipelineActionResult } | null>(null);
  const draftResult = draft?.id === draftId ? draft.result : null;
  const pipelineResult = config?.id === draftId ? config.result : null;
  useEffect(() => {
    let current = true;
    loadDraftForEditAction(draftId).catch((): DraftEditResult => ({ ok: false, reason: "no_response" })).then(result => {
      if (current) setDraft({ id: draftId, result });
    });
    loadDraftPipelineAction(draftId).catch((): DraftPipelineActionResult => ({ ok: false, reason: "no_response", reference: {} })).then(result => {
      if (current) setConfig({ id: draftId, result });
    });
    return () => { current = false; };
  }, [draftId, attempt]);
  const retry = () => { setDraft(null); setConfig(null); setAttempt(value => value + 1); };
  const title = draftResult?.ok ? draftResult.seed.model.fields.title || "Sin título" : "Pipeline";
  const failure = draftResult && !draftResult.ok ? draftResult.reason
    : pipelineResult && !pipelineResult.ok ? pipelineLoadReason(pipelineResult.reason) : null;
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader title={title} parent={{ label: "Vacantes", href: "/empresa/vacantes" }} status={draftResult?.ok ? <Badge variant="info" dot>Borrador</Badge> : draftResult === null ? <Skeleton aria-hidden="true" className="h-5 w-24" /> : undefined} />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent width="screen-2xl" className="gap-5 md:gap-6">
          <section aria-labelledby="draft-pipeline-heading" className="flex flex-col gap-1.5">
            <h2 id="draft-pipeline-heading" className="font-heading text-[20px] font-semibold text-foreground">Pipeline</h2>
            <p className="max-w-prose text-[13.5px] text-muted-foreground">Configura las columnas por las que pasarán los candidatos de esta vacante. Los candidatos aparecerán aquí cuando se publique.</p>
          </section>
          {failure ? <DraftEditErrorState reason={failure} onRetry={retry} />
            : draftResult?.ok && pipelineResult?.ok ? <PipelineStageEditor key={draftId} draftId={draftId} pipeline={pipelineResult.pipeline} etag={pipelineResult.etag} />
            : <PipelineEditorSkeleton />}
        </DashboardPageContent>
      </div>
    </div>
  );
}
