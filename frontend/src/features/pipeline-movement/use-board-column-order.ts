"use client";
import { useEffect, useRef, useState } from "react";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadDraftPipelineAction, saveDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { canMoveTo, editorFromPipeline, moveStageTo, toPutBody, validateEditor } from "@/features/jobs/drafts/pipeline/editor-model";
import type { Board } from "./model";
import type { Notice } from "./board-feedback";

type Loaded = Extract<DraftPipelineActionResult, { ok: true }>;
const noResponse = { ok: false, reason: "no_response", reference: {} } as const;
async function readPipeline(id: string): Promise<DraftPipelineActionResult> {
  try { return await loadDraftPipelineAction(id) ?? noResponse; } catch { return noResponse; }
}

/** A separate pipeline ETag protects the full replacement; no board/card ETag is used.
 * A failed read blocks further column writes. All recovery paths are read-only. */
export function useBoardColumnOrder(vacancyId: string, board: Board | null, disabled: boolean, reloadBoard: () => Promise<boolean>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [optimistic, setOptimistic] = useState<Loaded["pipeline"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ key: string; targetIndex: number; name: string; position: string } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const mutex = useRef(false);
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
  const structureLocked = !!loaded?.pipeline.structure_locked || !!board?.participations.length;
  // Do not reorder against two different structural snapshots (e.g. a concurrent edit).
  const matches = !!board && !!editor && board.exit.id === editor.exit.id
    && board.stages.length === editor.stages.length
    && board.stages.every((stage, index) => stage.id === editor.stages[index].id);
  const locked = disabled || busy || unavailable || structureLocked || !matches;
  function report(value: Notice, title: string, reference?: { status?: number; code?: string }) {
    setNotice(value);
    notifyActionResult({ key: "pipeline-column-order", type: value.tone,
      title, description: value.text,
      ...(value.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}) });
  }
  async function refresh() {
    if (mutex.current) return;
    mutex.current = true; setBusy(true);
    const [config, boardOk] = await Promise.all([readPipeline(vacancyId), reloadBoard()]);
    if (!alive.current) return;
    if (config.ok) setLoaded(config);
    setUnavailable(!config.ok || !boardOk);
    report({ tone: config.ok && boardOk ? "info" : "error", text: config.ok && boardOk ? "Columnas actualizadas. No repetimos el guardado." : "No pudimos actualizar las columnas. Intenta leerlas de nuevo antes de reordenar." }, config.ok && boardOk ? "Actualizamos el tablero" : "No se actualizaron las columnas", config.ok ? undefined : config.reference);
    setBusy(false); mutex.current = false;
  }
  async function move(key: string, targetIndex: number) {
    if (mutex.current || locked || confirmation || !editor || !canMoveTo(editor, key, targetIndex)) return;
    const next = moveStageTo(editor, key, targetIndex);
    if (!validateEditor(next).ok) return;
    setConfirmation({ key, targetIndex, name: next.stages[targetIndex].name, position: targetIndex === 1 ? `antes de ${next.stages[targetIndex + 1].name}` : `después de ${next.stages[targetIndex - 1].name}` });
  }
  function closeConfirmation() { if (!mutex.current) setConfirmation(null); }
  async function confirmMove() {
    if (!confirmation) return;
    const { key, targetIndex } = confirmation;
    if (mutex.current || locked || !loaded || !editor || !canMoveTo(editor, key, targetIndex)) return;
    const next = moveStageTo(editor, key, targetIndex);
    if (!validateEditor(next).ok) return;
    mutex.current = true; setBusy(true); setNotice(null);
    setOptimistic({ ...loaded.pipeline, stages: next.stages.map(stage => ({ id: stage.id!, kind: stage.kind, name: stage.name })) });
    let result: DraftPipelineActionResult;
    try { result = await saveDraftPipelineAction({ draftId: vacancyId, ifMatch: loaded.etag, body: toPutBody(next) }); }
    catch { result = noResponse; }
    if (!alive.current) return;
    if (result.ok) {
      setLoaded(result); setOptimistic(result.pipeline);
      const boardOk = await reloadBoard();
      if (!alive.current) return;
      setUnavailable(!boardOk);
      const index = result.pipeline.stages.findIndex(stage => stage.id === key);
      const stages = result.pipeline.stages;
      const position = index === 1
        ? `${stages[index].name} ahora va antes de ${stages[index + 1].name}.`
        : `${stages[index].name} ahora va después de ${stages[index - 1].name}.`;
      report({ tone: "success", text: `${position}${boardOk ? "" : " Actualiza el tablero antes de continuar."}` }, "Columnas reordenadas");
    } else {
      // Every rejection/uncertain result returns to server order with exactly one
      // config GET and one board GET, never an automatic second PUT.
      setOptimistic(null);
      const [config, boardOk] = await Promise.all([readPipeline(vacancyId), reloadBoard()]);
      if (!alive.current) return;
      if (config.ok) setLoaded(config);
      setUnavailable(!config.ok || !boardOk);
      const text = result.reason === "stage_change_requires_empty_pipeline"
        ? "La vacante ya tiene candidatos: las columnas solo se pueden renombrar."
        : result.reason === "version_conflict"
          ? "Otro usuario cambió las columnas. Actualizamos el tablero."
          : "No pudimos confirmar el cambio. Actualizamos el tablero sin repetir el guardado.";
      report({ tone: "error", text: config.ok && boardOk ? text : "No pudimos actualizar las columnas. Los cambios están bloqueados; usa Actualizar columnas para comprobar, sin repetir el guardado." }, "No se guardó el orden de columnas", result.reference);
    }
    setOptimistic(null); setBusy(false); mutex.current = false; setConfirmation(null);
  }
  const displayBoard = board && optimistic ? { ...board, stages: optimistic.stages.map(stage => ({ ...stage, count: board.stages.find(item => item.id === stage.id)?.count ?? 0 })) } : board;
  return { board: displayBoard, editor, locked: locked || !!confirmation, confirmation, closeConfirmation, confirmMove, structureLocked, busy, unavailable: unavailable || (!!editor && !!board && !matches && !busy), notice, move, refresh };
}
export type BoardColumnOrder = ReturnType<typeof useBoardColumnOrder>;
