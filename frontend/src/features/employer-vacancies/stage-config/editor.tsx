"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldDescription, FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { loadDraftPipelineAction, saveDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import {
  addCustomStage, adoptSavedPipeline, canAddCustomStage, criticalRenames, editorFromPipeline, isEditorDirty,
  moveStage, moveStageTo, reconcileUncertainSave, removeCustomStage, renameStage, toPutBody, validateEditor,
  type EditorPipeline, type PipelineEditorState,
} from "@/features/jobs/drafts/pipeline/editor-model";
import { CriticalRenameDialog } from "./critical-rename-dialog";
import { conflictNotice, invalidNotice, pipelineFailureNotice, recoveryLabels, savedNotice, type PipelineNotice } from "./feedback";
import { PipelinePreview } from "./preview";
import { StageRow } from "./stage-row";
import { StageReorder } from "./reorder";
import { SubstatesSheet } from "@/features/employer-vacancies/substates-config/sheet";
import type { SubstatesCatalog } from "@/features/jobs/drafts/pipeline/substates-model";
import { loadDraftDeliveryAction, type DraftDeliveryActionResult } from "@/features/jobs/drafts/pipeline/delivery-actions";

type Session = { editor: PipelineEditorState; etag: string };
const noResponse = (): DraftPipelineActionResult => ({ ok: false, reason: "no_response", reference: {} });

/** An isolated, in-memory editing session. No autosave and no automatic mutation retry. */
export function PipelineStageEditor({ draftId, pipeline, etag, substates, substatesEtag, cutoffStageId: initialCutoffStageId = null }: {
  draftId: string; pipeline: EditorPipeline; etag: string; substates?: SubstatesCatalog; substatesEtag?: string; cutoffStageId?: string | null;
}) {
  const [cutoffStageId, setCutoffStageId] = useState(initialCutoffStageId);
  const [cutoffRejected, setCutoffRejected] = useState(false);
  const [savedSubstates, setSavedSubstates] = useState(() => substates && substatesEtag ? { catalog: substates, etag: substatesEtag } : null);
  const [substatesOpen, setSubstatesOpen] = useState(false);
  const [session, setSession] = useState<Session>(() => ({ editor: editorFromPipeline(pipeline), etag }));
  const current = useRef(session);
  const [pending, setPending] = useState<"save" | "reload" | "check" | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState<PipelineNotice | null>(null);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const statusLink = useRef<HTMLAnchorElement>(null);
  const focusOnMount = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const state = session.editor;
  const dirty = isEditorDirty(state);
  const errors = validateEditor(state).errors;
  function replace(editor: PipelineEditorState, nextEtag = current.current.etag) {
    const next = { editor, etag: nextEtag };
    current.current = next;
    setSession(next);
  }
  function edit(editor: PipelineEditorState) {
    if (!busy.current) replace(editor);
  }
  function report(next: PipelineNotice, reference?: { status?: number; code?: string }) {
    setNotice(next);
    const action = next.recovery
      ? { title: recoveryLabels[next.recovery], onClick: () => { void recover(next.recovery!); } }
      : next.link ? { title: next.link.title, onClick: () => { statusLink.current?.click(); } } : undefined;
    notifyActionResult({
      key: "pipeline-save", type: next.tone, title: next.title, description: next.description,
      ...(next.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}), action,
    });
  }
  function adopt(response: Extract<DraftPipelineActionResult, { ok: true }>, attemptedState: PipelineEditorState) {
    replace(adoptSavedPipeline(attemptedState, response.pipeline), response.etag);
    setTouched(new Set()); setAttempted(false); setCutoffRejected(false);
  }
  async function persist() {
    if (busy.current) return;
    const snapshot = current.current;
    busy.current = true; setPending("save"); setConfirming(false); setNotice(null);
    const result = await saveDraftPipelineAction({ draftId, ifMatch: snapshot.etag, body: toPutBody(snapshot.editor) }).catch(noResponse);
    if (!mounted.current) return;
    if (result.ok) {
      adopt(result, snapshot.editor);
      report(result.pipeline.version === snapshot.editor.baseline.version
        ? { tone: "info", title: "No había cambios que guardar", text: "Guardado" }
        : savedNotice);
    } else if (result.reason === "cutoff_stage_in_use") {
      setCutoffRejected(true);
      report({ ...pipelineFailureNotice(result.reason), link: { title: "Ir a Entrega", href: `/empresa/vacantes/${draftId}/configuracion/entrega` } }, result.reference);
      const removedIds = snapshot.editor.baseline.stages.filter(stage => !snapshot.editor.stages.some(edited => edited.id === stage.id)).map(stage => stage.id);
      if (cutoffStageId === null || !removedIds.includes(cutoffStageId)) {
        // The error envelope intentionally carries no stage id. Read once, never retry PUT.
        const delivery = await loadDraftDeliveryAction(draftId).catch((): DraftDeliveryActionResult => ({ ok: false, reason: "no_response", reference: {} }));
        if (!mounted.current) return;
        if (delivery.ok) setCutoffStageId(delivery.delivery.cutoffStageId);
      }
    } else report(pipelineFailureNotice(result.reason), result.reference);
    busy.current = false; setPending(null);
  }
  function requestSave() {
    if (busy.current || !isEditorDirty(current.current.editor)) return;
    setAttempted(true);
    const validation = validateEditor(current.current.editor);
    if (!validation.ok) {
      report(invalidNotice);
      const first = [...current.current.editor.stages, current.current.editor.exit].find(entry => validation.errors[entry.key]);
      if (first) inputs.current.get(first.key)?.focus();
      return;
    }
    if (criticalRenames(current.current.editor).length) setConfirming(true);
    else void persist();
  }
  async function recover(mode: "reload" | "check") {
    if (busy.current || !mounted.current) return;
    busy.current = true; setPending(mode);
    const snapshot = current.current;
    const result = await loadDraftPipelineAction(draftId).catch(noResponse);
    if (!mounted.current) return;
    if (!result.ok) {
      const failure = pipelineFailureNotice(result.reason);
      report({ ...failure, description: "No pudimos cargar la versión guardada. Tus cambios siguen aquí. Puedes volver a comprobarla; no se enviará otro guardado.", text: "No se pudo cargar · tus cambios siguen aquí", recovery: mode }, result.reference);
    } else if (mode === "reload") {
      // A deliberate replacement may have a different order; do not reuse positional keys.
      replace(editorFromPipeline(result.pipeline), result.etag);
      setTouched(new Set()); setAttempted(false); setCutoffRejected(false);
      report({ tone: "info", title: "Versión actual cargada", text: "Versión actual cargada", description: "El editor muestra las columnas guardadas actualmente." });
    } else {
      const outcome = reconcileUncertainSave(snapshot.editor, result.pipeline);
      if (outcome === "saved") { adopt(result, snapshot.editor); report(savedNotice); }
      else if (outcome === "not_saved") report({ tone: "info", title: "No se guardó el pipeline", text: "No se guardó. Puedes guardar de nuevo; es seguro.", description: "Tus cambios siguen aquí. Puedes guardar de nuevo; es seguro." });
      else report(conflictNotice);
    }
    busy.current = false; setPending(null);
  }
  function add() {
    if (busy.current) return;
    const next = addCustomStage(current.current.editor);
    const added = next.stages.find(entry => !current.current.editor.stages.some(previous => previous.key === entry.key));
    replace(next);
    if (added) {
      // Ref callbacks run after the new input commits; focus is limited to this editor.
      focusOnMount.current = added.key;
    }
  }
  function row(stage: PipelineEditorState["stages"][number] | PipelineEditorState["exit"], position: number) {
    return <StageRow key={stage.key} stage={stage} position={position} state={state} disabled={pending !== null}
      error={attempted || touched.has(stage.key) ? errors[stage.key] : undefined}
      inputRef={node => {
        if (node) {
          inputs.current.set(stage.key, node);
          if (focusOnMount.current === stage.key) { node.focus(); focusOnMount.current = null; }
        } else inputs.current.delete(stage.key);
      }}
      onRename={name => edit(renameStage(current.current.editor, stage.key, name))}
      onBlur={() => setTouched(previous => new Set(previous).add(stage.key))}
      onMove={direction => edit(moveStage(current.current.editor, stage.key, direction))}
      cutoffStageId={cutoffStageId} cutoffError={cutoffRejected && stage.id !== null && stage.id === cutoffStageId}
      onRemove={() => { if (cutoffStageId === null || stage.id !== cutoffStageId) edit(removeCustomStage(current.current.editor, stage.key)); }}
      substateCount={savedSubstates?.catalog.substates.length}
      onSubstates={() => { if (!busy.current && savedSubstates) setSubstatesOpen(true); }} />;
  }
  const removedCutoff = cutoffRejected && cutoffStageId !== null && !state.stages.some(stage => stage.id === cutoffStageId)
    ? state.baseline.stages.find(stage => stage.id === cutoffStageId) : undefined;
  const recovery = notice?.recovery;
  const statusAction = recovery ? <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={() => void recover(recovery)}>
    {pending === recovery && <Spinner aria-hidden="true" data-icon="inline-start" />}{recoveryLabels[recovery]}
  </Button> : notice?.link ? <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link ref={statusLink} href={notice.link.href} target="_blank" rel="noopener noreferrer" />}>{notice.link.title}</Button> : undefined;
  return (
    <>
      <Card aria-labelledby="pipeline-columns-heading">
        <CardHeader className="border-b has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
          <CardTitle><h3 id="pipeline-columns-heading">Columnas del pipeline</h3></CardTitle>
          <CardDescription>Nuevos va primero y Placement al final. Puedes agregar hasta {state.limits.maxCustomStages} columnas propias.</CardDescription>
          <CardAction className="col-start-1 row-span-1 row-start-auto justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end"><Badge variant="neutral">{state.stages.filter(entry => entry.kind === "custom").length} de {state.limits.maxCustomStages} columnas propias</Badge></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {removedCutoff && <div className="flex flex-col items-start gap-2">
            <Badge variant="info">Corte de entrega</Badge>
            <FieldError>{removedCutoff.name} es el corte de entrega. Cámbiala en Entrega antes de quitarla.</FieldError>
          </div>}
          <StageReorder state={state} disabled={pending !== null}
            onMove={(key, targetIndex) => edit(moveStageTo(current.current.editor, key, targetIndex))}>
            <ol aria-label="Columnas del pipeline" className="flex flex-col gap-3">{state.stages.map((stage, index) => row(stage, index + 1))}</ol>
          </StageReorder>
          <div className="flex flex-col items-start gap-2">
            <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null || !canAddCustomStage(state)} onClick={add}>
              <Plus aria-hidden="true" data-icon="inline-start" />Agregar columna
            </Button>
            {!canAddCustomStage(state) && <FieldDescription>Llegaste al máximo de {state.limits.maxCustomStages} columnas propias.</FieldDescription>}
          </div>
          <Separator />
          <section aria-labelledby="pipeline-exit-heading" className="flex flex-col gap-3">
            <h4 id="pipeline-exit-heading" className="font-heading text-base font-medium">Salida del proceso</h4>
            <p className="text-sm text-muted-foreground">Descartados queda fuera del orden: un candidato puede salir desde cualquier etapa.</p>
            {row(state.exit, state.stages.length + 1)}
          </section>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-2 border-t">
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="min-h-10" disabled={!dirty || pending !== null} onClick={() => {
              edit(editorFromPipeline(current.current.editor.baseline)); setTouched(new Set()); setAttempted(false); setCutoffRejected(false); setNotice(null);
            }}>Descartar cambios</Button>
            <Button type="button" className="min-h-10" disabled={!dirty || pending !== null} aria-busy={pending === "save"}
              aria-describedby={notice ? "pipeline-save-status" : undefined} onClick={requestSave}>
              {pending === "save" && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending === "save" ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
          <ActionStatusSlot>{notice && <ActionStatus id="pipeline-save-status" tone={dirty && notice.text === "Guardado" ? "info" : notice.tone} text={dirty && notice.text === "Guardado" ? "Cambios sin guardar" : notice.text} action={statusAction} />}</ActionStatusSlot>
        </CardFooter>
      </Card>
      <PipelinePreview state={state} />
      <CriticalRenameDialog open={confirming} onOpenChange={setConfirming} renames={criticalRenames(state)} onConfirm={() => void persist()} />
      {savedSubstates && <SubstatesSheet draftId={draftId} inProcessName={state.stages.find(stage => stage.kind === "in_process")?.name ?? ""}
        catalog={savedSubstates.catalog} etag={savedSubstates.etag} open={substatesOpen} onOpenChange={setSubstatesOpen}
        onSaved={(catalog: SubstatesCatalog, etag: string) => setSavedSubstates({ catalog, etag })} />}
    </>
  );
}
