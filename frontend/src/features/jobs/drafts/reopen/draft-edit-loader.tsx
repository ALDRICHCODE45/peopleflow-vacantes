"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalDraftForm } from "../ui/local-draft-form";
import { DraftEditErrorState } from "./error-state";
import { loadDraftForEditAction, type DraftEditResult } from "./load";

/** Reserve the editor's progress rail, first-step fields and navigation. */
function DraftEditorSkeleton() {
  return (
    <section aria-busy="true" aria-label="Editor de borrador" className="flex flex-col gap-5">
      <span role="status" className="sr-only">Cargando borrador</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48 max-w-full" />
        <Skeleton className="h-2 w-full" />
        <div className="grid grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map(step => <Skeleton key={step} className="h-6 w-full" />)}
        </div>
      </div>
      <Card aria-hidden="true">
        <CardHeader><Skeleton className="h-6 w-56 max-w-full" /></CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          {[0, 1, 2, 3, 4, 5, 6, 7].map(field => (
            <div key={field} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-28" />
        </CardFooter>
      </Card>
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
