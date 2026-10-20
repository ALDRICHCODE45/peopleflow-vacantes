"use client";

import { useEffect, useState } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalDraftForm } from "../ui/local-draft-form";
import { DRAFT_SAVE_NOTICE } from "../ui/draft-save-feedback";
import { DraftEditErrorState } from "./error-state";
import { loadDraftForEditAction, type DraftEditResult } from "./load";

/** Skeleton exception: mirror the first section's three topic Cards. */
function DraftEditorSkeleton() {
  const fields = (heights: string[]) => heights.map((height, index) => <Field key={index}>
    <FieldLabel><Skeleton className="h-5 w-28" /></FieldLabel>
    <Skeleton className={`${height} w-full`} />
  </Field>);
  return (
    <section aria-busy="true" aria-label="Editor de borrador" className="flex flex-col gap-5">
      <span role="status" className="sr-only">Cargando borrador</span>
      <div aria-hidden="true" className="flex flex-col gap-5">
        <div className="flex gap-2 rounded-2xl bg-muted/50 px-3 py-2"><Skeleton className="mt-0.5 size-4 shrink-0" /><Skeleton className="w-full max-w-prose text-sm"><span className="invisible">{DRAFT_SAVE_NOTICE}</span></Skeleton></div>
        <div className="flex flex-wrap items-center justify-between gap-5"><div className="flex flex-col gap-2"><Skeleton className="h-7 w-72 max-w-full" /><Skeleton className="h-5 w-64 max-w-full" /></div><Skeleton className="h-10 w-32" /></div>
        <div className="grid min-w-0 grid-cols-1 items-start gap-7 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 overflow-hidden lg:flex-col">
              {[0, 1, 2, 3, 4].map(step => <Skeleton key={step} className="h-12 w-44 shrink-0" />)}
            </div>
            <Skeleton className="h-2 w-full" /><Skeleton className="h-16 w-full" />
          </div>
          <section className="flex min-w-0 flex-col gap-5">
            <Skeleton className="h-7 w-56 max-w-full" />
            {[5, 1, 2].map((count, index) => <Card key={index}>
              <CardHeader>
                <CardTitle><Skeleton className="h-7 w-56 max-w-full" /></CardTitle>
                <CardDescription><Skeleton className="h-5 w-64 max-w-full" /></CardDescription>
                <CardAction><Skeleton className="h-5 w-20" /></CardAction>
              </CardHeader>
              <CardContent>
                <FieldGroup className="grid gap-6 sm:grid-cols-2">{fields(Array.from({ length: count }, () => "h-10"))}</FieldGroup>
              </CardContent>
            </Card>)}
          </section>
          <div className="hidden flex-col gap-4 xl:flex"><Skeleton className="h-5 w-32" /><Skeleton className="h-80 w-full" /></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-10 w-64" /></div>
      </div>
    </section>
  );
}

/** The read is an action, not an RSC fetch: refreshed cookies can be persisted. */
export function DraftEditLoader({draftId}:{draftId:string}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{draftId:string;attempt:number;result:DraftEditResult} | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      let result: DraftEditResult;
      try {
        result = await loadDraftForEditAction(draftId);
      } catch {
        result = {ok:false,reason:"no_response"};
      }
      // Each effect owns its response; neither unmount nor an id change may
      // allow an older read to seed the currently visible editor.
      if (active) setLoaded({draftId,attempt,result});
    }
    void load();
    return () => { active = false; };
  }, [draftId, attempt]);

  const result = loaded?.draftId === draftId && loaded.attempt === attempt ? loaded.result : null;
  if (!result) return <DraftEditorSkeleton />;
  if (!result.ok) return <DraftEditErrorState reason={result.reason} onRetry={() => setAttempt(previous => previous + 1)} />;
  return <LocalDraftForm key={draftId} initialModel={result.seed.model} initialScreeningQuestionsV2={result.seed.screeningQuestionsV2} initialIdentity={result.identity} />;
}
