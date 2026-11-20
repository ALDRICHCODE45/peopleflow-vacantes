"use client";

import { useEffect, useState } from "react";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadBoardAction } from "@/features/pipeline-movement/actions";
import { replacementSource, type ReplacementSource } from "./replacement-source";
import { StartReplacementHost } from "./start-replacement-host";

const FAILURE_TITLE = "No pudimos abrir el reemplazo";

/**
 * Portfolio entry point of «Iniciar reemplazo»: the list has no board, so the SOURCE board is read once when the flow is chosen
 * (stages for the carried candidates' starting stage, hires still in Placement for the disabled rows). A failed read says so and
 * leaves the portfolio as it was; nothing starts without the stages.
 */
export function PortfolioStartReplacement({ draftId, title, onClose }: { draftId: string; title: string; onClose: () => void }) {
  const [source, setSource] = useState<ReplacementSource | null>(null);
  useEffect(() => {
    let current = true;
    const fail = (reference: { status?: number; code?: string }) => {
      notifyActionResult({ key: `replacement-source-${draftId}`, type: "error", title: FAILURE_TITLE, description: "No se modificó la vacante. Vuelve a intentarlo.", reference: { ...reference, at: new Date().toISOString() } });
      onClose();
    };
    loadBoardAction(draftId).then(result => {
      if (!current) return;
      if (result.ok) setSource(replacementSource(result.data)); else fail(result.reference);
    }).catch(() => { if (current) fail({}); });
    return () => { current = false; };
  }, [draftId, onClose]);
  return source ? <StartReplacementHost draftId={draftId} title={title} source={source} onClose={onClose} /> : <span role="status" className="sr-only">Cargando etapas del reemplazo</span>;
}
