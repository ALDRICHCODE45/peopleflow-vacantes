"use client";

import { useEffect, useState } from "react";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalDraftForm } from "../ui/local-draft-form";
import { DRAFT_SAVE_NOTICE } from "../ui/draft-save-feedback";
import { DraftEditErrorState } from "./error-state";
import { loadDraftForEditAction, type DraftEditResult } from "./load";

/** Skeleton exception: mirror LocalDraftForm's first step, including its three field groups. */
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
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[0, 1, 2, 3, 4].map(step => <li key={step} className="flex min-w-0 items-center gap-2"><Skeleton className="size-6 shrink-0 rounded-full" /><Skeleton className="h-4 w-28 max-w-full" /></li>)}
            </ol>
            <Progress value={1} max={5}><ProgressLabel className="text-xs"><Skeleton className="h-4 w-24" /></ProgressLabel></Progress>
          </div>
          <section className="min-w-0">
            <Card>
              <CardHeader><CardTitle><Skeleton className="h-7 w-56 max-w-full" /></CardTitle><CardAction><Skeleton className="h-5 w-20" /></CardAction></CardHeader>
              <CardContent className="flex flex-col gap-6">
                <FieldGroup className="grid gap-4 sm:grid-cols-2">{fields(["h-8", "h-8", "h-10"])}</FieldGroup>
                <Separator />
                <section className="flex min-w-0 flex-col gap-4">
                  <Skeleton className="h-5 w-40" />
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">{fields(["h-10", "h-10", "h-10", "h-10"])}</FieldGroup>
                </section>
                <Separator />
                <section className="flex min-w-0 flex-col gap-4">
                  <Skeleton className="h-5 w-24" />
                  <FieldGroup className="gap-4">{fields(["h-10", "h-10"])}</FieldGroup>
                </section>
              </CardContent>
              <CardFooter className="flex-wrap items-center justify-between gap-3">
                <Skeleton className="h-10 w-16" /><div className="flex flex-wrap items-center gap-3"><Skeleton className="h-8 w-24" /></div>
              </CardFooter>
            </Card>
          </section>
        </div>
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
