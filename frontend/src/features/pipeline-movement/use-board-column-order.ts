"use client";
import { useEffect, useRef, useState } from "react";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadDraftPipelineAction, previewPipelineAction, saveDraftPipelineAction, type DraftPipelineActionFailure, type DraftPipelineActionResult, type PipelinePreviewActionResult } from "@/features/jobs/drafts/pipeline/actions";
import type { PipelineImpactPreview } from "@/features/jobs/drafts/pipeline/client";
import { canMoveTo, editorFromPipeline, moveStageTo, toPutBody, validateEditor, type PipelineEditorState } from "@/features/jobs/drafts/pipeline/editor-model";
import { appliedImpactNotice, pipelineFailureNotice } from "@/features/employer-vacancies/stage-config/feedback";
import type { Board } from "./model";
import type { Notice } from "./board-feedback";

type Loaded = Extract<DraftPipelineActionResult, { ok: true }>;
type Confirmation = { key: string; name: string; position: string; next: PipelineEditorState; etag: string; preview: PipelineImpactPreview };
type ColumnNotice = Notice & { link?: { href: string; title: string } };
const noResponse = { ok: false, reason: "no_response", reference: {} } as const;
async function readPipeline(id: string): Promise<DraftPipelineActionResult> {
  try { return await loadDraftPipelineAction(id) ?? noResponse; } catch { return noResponse; }
}

/** Preview and confirmation share one immutable proposal/ETag. Neither changes the
 * board. A failed write reconciles once; retry always requires a fresh user intent. */
export function useBoardColumnOrder(vacancyId: string, board: Board | null, disabled: boolean, reloadBoard: () => Promise<boolean>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pending, setPending] = useState<"preview" | "save" | "refresh" | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState<ColumnNotice | null>(null);
  const mutex = useRef(false);
  const intent = useRef<Confirmation | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    let current = true;
    void readPipeline(vacancyId).then(result => {
      if (!current) return;
      if (result.ok) setLoaded(result);
      else setUnavailable(true);
    });
    return () => { current = false; alive.current = false; };
  }, [vacancyId]);
  const editor = loaded ? editorFromPipeline(loaded.pipeline) : null;
  const busy = pending !== null;
  // Do not reorder against two different structural snapshots (e.g. a concurrent edit).
  const matches = !!board && !!editor && board.exit.id === editor.exit.id
    && board.stages.length === editor.stages.length
    && board.stages.every((stage, index) => stage.id === editor.stages[index].id);
  const locked = disabled || busy || unavailable || !matches;
  function report(value: ColumnNotice, title: string, reference?: { status?: number; code?: string }) {
    setNotice(value);
    notifyActionResult({ key: "pipeline-column-order", type: value.tone,
      title, description: value.text,
      ...(value.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}) });
  }
  function reportFailure(result: DraftPipelineActionFailure, previewOnly: boolean, refreshed = true) {
    const mapped = pipelineFailureNotice(result.reason);
    const previewUnavailable = previewOnly && ["no_response", "server_error", "unrecognized_response", "precondition_required"].includes(result.reason);
    // The editor's mapping owns causes/titles. Board recovery has no unsaved form:
    // explain its read-only reconciliation instead of claiming edits were retained.
    const text = previewUnavailable
      ? "No pudimos revisar el impacto. No se guardó ningún cambio. Puedes revisar de nuevo; es seguro."
      : !refreshed
        ? "No pudimos actualizar las columnas. Los cambios están bloqueados; usa Actualizar columnas para comprobar, sin repetir el guardado."
        : mapped.reviewImpact
          ? "El proceso cambió. Vuelve a mover la columna para revisar el impacto antes de confirmar otra vez. No repetimos el guardado."
          : mapped.recovery
            ? "Actualizamos el tablero para comprobar el orden actual. Revisa las columnas antes de volver a moverlas; no repetimos el guardado."
            : result.reason === "stage_occupied" || result.reason === "cutoff_stage_in_use"
              ? mapped.description!
              : `${mapped.text}. Vuelve a mover la columna cuando hayas resuelto el aviso.`;
    const link = result.reason === "cutoff_stage_in_use"
      ? { href: `/empresa/vacantes/${vacancyId}/configuracion/entrega`, title: "Ir a Entrega" }
      : mapped.link;
    report({ tone: "error", text, link }, previewUnavailable ? "No pudimos revisar el impacto" : mapped.title, result.reference);
  }
  async function refresh() {
    if (mutex.current || intent.current) return;
    mutex.current = true; setPending("refresh");
    const [config, boardOk] = await Promise.all([readPipeline(vacancyId), reloadBoard()]);
    if (!alive.current) return;
    if (config.ok) setLoaded(config);
    setUnavailable(!config.ok || !boardOk);
    report({ tone: config.ok && boardOk ? "info" : "error", text: config.ok && boardOk ? "Columnas actualizadas. No repetimos el guardado." : "No pudimos actualizar las columnas. Intenta leerlas de nuevo antes de reordenar." }, config.ok && boardOk ? "Actualizamos el tablero" : "No se actualizaron las columnas", config.ok ? undefined : config.reference);
    setPending(null); mutex.current = false;
  }
  async function move(key: string, targetIndex: number) {
    if (mutex.current || locked || intent.current || !loaded || !editor || !canMoveTo(editor, key, targetIndex)) return;
    const next = moveStageTo(editor, key, targetIndex);
    if (!validateEditor(next).ok) return;
    mutex.current = true; setPending("preview"); setNotice(null);
    let result: PipelinePreviewActionResult;
    try { result = await previewPipelineAction({ draftId: vacancyId, body: toPutBody(next) }); }
    catch { result = noResponse; }
    if (!alive.current) return;
    if (result.ok) {
      const position = targetIndex === 1 ? `antes de ${next.stages[targetIndex + 1].name}` : `después de ${next.stages[targetIndex - 1].name}`;
      const value = { key, name: next.stages[targetIndex].name, position, next, etag: loaded.etag, preview: result.preview };
      intent.current = value; setConfirmation(value);
    } else reportFailure(result, true);
    setPending(null); mutex.current = false;
  }
  function closeConfirmation() {
    if (!mutex.current) { intent.current = null; setConfirmation(null); }
  }
  async function confirmMove() {
    const proposal = intent.current;
    if (!proposal || mutex.current || locked) return;
    mutex.current = true; setPending("save"); setNotice(null);
    let result: DraftPipelineActionResult;
    try { result = await saveDraftPipelineAction({ draftId: vacancyId, ifMatch: proposal.etag, body: { ...toPutBody(proposal.next), confirm_impact: true } }); }
    catch { result = noResponse; }
    if (!alive.current) return;
    if (result.ok) {
      setLoaded(result);
      const boardOk = await reloadBoard();
      if (!alive.current) return;
      setUnavailable(!boardOk);
      const index = result.pipeline.stages.findIndex(stage => stage.id === proposal.key);
      const stages = result.pipeline.stages;
      const position = index === 1
        ? `${stages[index].name} ahora va antes de ${stages[index + 1].name}.`
        : `${stages[index].name} ahora va después de ${stages[index - 1].name}.`;
      const impact = result.pipeline.applied_impact ? appliedImpactNotice(result.pipeline.applied_impact, proposal.preview).description : undefined;
      report({ tone: "success", text: [position, impact, !boardOk && "Actualiza el tablero antes de continuar."].filter(Boolean).join(" ") }, "Columnas reordenadas");
    } else {
      const [config, boardOk] = await Promise.all([readPipeline(vacancyId), reloadBoard()]);
      if (!alive.current) return;
      if (config.ok) setLoaded(config);
      setUnavailable(!config.ok || !boardOk);
      reportFailure(result, false, config.ok && boardOk);
    }
    intent.current = null; setConfirmation(null); setPending(null); mutex.current = false;
  }
  return { board, editor, locked: locked || !!confirmation, confirmation, closeConfirmation, confirmMove, busy, pending,
    unavailable: unavailable || (!!editor && !!board && !matches && !busy), notice, move, refresh };
}
export type BoardColumnOrder = ReturnType<typeof useBoardColumnOrder>;
