"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldDescription, FieldError } from "@/components/ui/field";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { STAGE_KIND_LABELS, normalizeStageName } from "@/features/jobs/drafts/pipeline/editor-model";
import { loadDraftSubstatesAction, saveDraftSubstatesAction, type DraftSubstatesActionResult } from "@/features/jobs/drafts/pipeline/substates-actions";
import {
  add, adoptSaved, availableSuggestions, canAdd, fromCatalog, isDirty, move, moveTo, reconcileUncertainSave, remove, rename, toPutBody, validate,
  type SubstatesCatalog, type SubstatesEditorState,
} from "@/features/jobs/drafts/pipeline/substates-model";
import { conflictNotice, invalidNotice, recoveryLabels, savedNotice, substatesFailureNotice, type PipelineNotice } from "./feedback";
import { SubstateRow } from "./row";
import { SubstatesReorder } from "./reorder";

type Props = {
  draftId: string;
  inProcessName: string;
  catalog: SubstatesCatalog;
  etag: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Confirmed server state only. Never modifies the columns editing session. */
  onSaved: (catalog: SubstatesCatalog, etag: string) => void;
};
type Session = { editor: SubstatesEditorState; etag: string };
const noResponse = (): DraftSubstatesActionResult => ({ ok: false, reason: "no_response", reference: {} });

/** Each opening starts a fresh copy of the saved catalog, not the previous unsaved session. */
export function SubstatesSheet({ open, ...props }: Props) {
  return open ? <SubstatesSheetSession {...props} /> : null;
}

function SubstatesSheetSession({ draftId, inProcessName, catalog, etag, onOpenChange, onSaved }: Omit<Props, "open">) {
  const [session, setSession] = useState<Session>(() => ({ editor: fromCatalog(catalog), etag }));
  const current = useRef(session);
  const [pending, setPending] = useState<"save" | "reload" | "check" | null>(null);
  const busy = useRef(false);
  const dragging = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState<PipelineNotice | null>(null);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusOnMount = useRef<string | null>(null);
  const statusLink = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = session.editor;
  const dirty = isDirty(state);
  const errors = validate(state).errors;
  function replace(editor: SubstatesEditorState, nextEtag = current.current.etag) {
    const next = { editor, etag: nextEtag }; current.current = next; setSession(next);
  }
  function edit(editor: SubstatesEditorState) { if (!busy.current) replace(editor); }
  function requestClose() {
    if (busy.current) return;
    if (isDirty(current.current.editor)) setConfirmingDiscard(true);
    else onOpenChange(false);
  }
  function report(next: PipelineNotice, reference?: { status?: number; code?: string }) {
    setNotice(next);
    const action = next.recovery ? { title: recoveryLabels[next.recovery], onClick: () => { void recover(next.recovery!); } }
      : next.link ? { title: next.link.title, onClick: () => { statusLink.current?.click(); } } : undefined;
    notifyActionResult({ key: "substates-save", type: next.tone, title: next.title, description: next.description,
      ...(next.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}), action });
  }
  function adopt(response: Extract<DraftSubstatesActionResult, { ok: true }>, attemptedState: SubstatesEditorState) {
    replace(adoptSaved(attemptedState, response.catalog), response.etag); setTouched(new Set()); setAttempted(false);
    onSaved(response.catalog, response.etag);
  }
  async function persist() {
    if (busy.current) return;
    const snapshot = current.current; busy.current = true; setPending("save"); setNotice(null);
    const result = await saveDraftSubstatesAction({ draftId, ifMatch: snapshot.etag, body: toPutBody(snapshot.editor) }).catch(noResponse);
    if (!mounted.current) return;
    if (result.ok) {
      adopt(result, snapshot.editor);
      report(result.catalog.version === snapshot.editor.baseline.version ? { tone: "info", title: "No había cambios que guardar", text: "Guardado" } : savedNotice);
      onOpenChange(false);
    } else report(substatesFailureNotice(result.reason), result.reference);
    busy.current = false; setPending(null);
  }
  function requestSave() {
    if (busy.current || !isDirty(current.current.editor)) return;
    setAttempted(true);
    const validation = validate(current.current.editor);
    if (!validation.ok) {
      report(invalidNotice);
      const first = current.current.editor.entries.find(entry => validation.errors[entry.key]);
      if (first) inputs.current.get(first.key)?.focus();
      return;
    }
    void persist();
  }
  async function recover(mode: "reload" | "check") {
    if (busy.current || !mounted.current) return;
    busy.current = true; setPending(mode);
    const snapshot = current.current;
    const result = await loadDraftSubstatesAction(draftId).catch(noResponse);
    if (!mounted.current) return;
    if (!result.ok) {
      report({ ...substatesFailureNotice(result.reason), description: "No pudimos cargar la versión guardada. Tus cambios siguen aquí. Puedes volver a comprobarla; no se enviará otro guardado.", text: "No se pudo cargar · tus cambios siguen aquí", recovery: mode }, result.reference);
    } else if (mode === "reload") {
      replace(fromCatalog(result.catalog), result.etag); setTouched(new Set()); setAttempted(false);
      onSaved(result.catalog, result.etag);
      report({ tone: "info", title: "Versión actual cargada", text: "Versión actual cargada", description: "El editor muestra los subestados guardados actualmente." });
    } else {
      const outcome = reconcileUncertainSave(snapshot.editor, result.catalog);
      if (outcome === "saved") { adopt(result, snapshot.editor); report(savedNotice); onOpenChange(false); }
      else if (outcome === "not_saved") {
        replace(snapshot.editor, result.etag);
        report({ tone: "info", title: "No se guardaron los subestados", text: "No se guardó. Puedes guardar de nuevo; es seguro.", description: "Tus cambios siguen aquí. Puedes guardar de nuevo; es seguro." });
      } else report(conflictNotice);
    }
    busy.current = false; setPending(null);
  }
  function addEntry(name = "") {
    if (busy.current) return;
    const next = add(current.current.editor, name);
    const added = next.entries.find(entry => !current.current.editor.entries.some(previous => previous.key === entry.key));
    replace(next);
    if (added) focusOnMount.current = added.key;
  }
  const suggestions = availableSuggestions(state);
  const recovery = notice?.recovery;
  const statusAction = recovery ? <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={() => void recover(recovery)}>
    {pending === recovery && <Spinner aria-hidden="true" data-icon="inline-start" />}{recoveryLabels[recovery]}
  </Button> : notice?.link ? <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link ref={statusLink} href={notice.link.href} target="_blank" rel="noopener noreferrer" />}>{notice.link.title}</Button> : undefined;
  return <Sheet open onOpenChange={(open, details) => {
    if (open) return;
    // Escape belongs to the active drag, not the surrounding editing session.
    if (details.reason === "escape-key" && (dragging.current || details.event.defaultPrevented)) {
      details.cancel(); details.allowPropagation(); return;
    }
    if (busy.current) { details.cancel(); return; }
    requestClose();
  }}>
    {/* Same-specificity primitive widths otherwise win by stylesheet order. Geometry only. */}
    <SheetContent side="right" showCloseButton={false} className="data-[side=right]:w-full! data-[side=right]:sm:max-w-lg! overflow-hidden"
      onKeyDown={event => {
        // Base UI stops composite keys at its popup; dnd-kit's sensor listens on document.
        if (dragging.current && (event.key === "ArrowUp" || event.key === "ArrowDown")) event.preventBaseUIHandler();
      }}>
      <SheetHeader className="border-b pr-16">
        <SheetTitle>Subestados de {normalizeStageName(inProcessName) || STAGE_KIND_LABELS.in_process}</SheetTitle>
        <SheetDescription>Úsalos para registrar en qué punto del proceso está cada candidato, por ejemplo cada entrevista. No son pasos obligatorios ni tienen que seguir un orden.</SheetDescription>
        <div><Badge variant="neutral">{state.entries.length} de {state.limits.maxSubstates} subestados</Badge></div>
      </SheetHeader>
      <SheetClose disabled={pending !== null} render={<Button type="button" variant="ghost" size="icon" className="absolute right-4 top-4 size-10" aria-label="Cerrar subestados" />}><X aria-hidden="true" /></SheetClose>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        {suggestions.length > 0 && <section aria-labelledby="substates-suggestions-heading" className="flex flex-col gap-2">
          <h3 id="substates-suggestions-heading" className="font-heading text-sm font-medium">Sugerencias</h3>
          <div className="flex flex-wrap justify-start gap-2">{suggestions.map(suggestion => <Button key={suggestion} type="button" variant="outline" size="sm" className="min-h-10 h-auto whitespace-normal text-left" disabled={pending !== null || !canAdd(state)} aria-label={`Agregar ${suggestion}`} onClick={() => addEntry(suggestion)}>
            <Plus aria-hidden="true" data-icon="inline-start" />{suggestion}
          </Button>)}</div>
        </section>}
        {state.entries.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay subestados. Elige una sugerencia o agrega uno.</p> : <SubstatesReorder state={state} disabled={pending !== null} onDragStateChange={active => { dragging.current = active; }} onMove={(key, target) => edit(moveTo(current.current.editor, key, target))}>
          <ol aria-label="Subestados" className="flex flex-col gap-2">{state.entries.map((entry, index) => <SubstateRow key={entry.key} entry={entry} position={index + 1} state={state} disabled={pending !== null}
            error={attempted || touched.has(entry.key) ? errors[entry.key] : undefined}
            inputRef={node => { if (node) { inputs.current.set(entry.key, node); if (focusOnMount.current === entry.key) { node.focus(); focusOnMount.current = null; } } else inputs.current.delete(entry.key); }}
            onRename={name => edit(rename(current.current.editor, entry.key, name))} onBlur={() => setTouched(previous => new Set(previous).add(entry.key))}
            onMove={direction => edit(move(current.current.editor, entry.key, direction))} onRemove={() => edit(remove(current.current.editor, entry.key))} />)}</ol>
        </SubstatesReorder>}
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null || !canAdd(state)} onClick={() => addEntry()}><Plus aria-hidden="true" data-icon="inline-start" />Agregar subestado</Button>
          {!canAdd(state) && <FieldDescription>Llegaste al máximo de {state.limits.maxSubstates} subestados.</FieldDescription>}
        </div>
        {errors.$catalog && <FieldError>No puedes guardar más de {state.limits.maxSubstates} subestados.</FieldError>}
      </div>
      <SheetFooter className="border-t">
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" className="min-h-10" disabled={pending !== null} onClick={requestClose}>Cancelar</Button>
          <Button type="button" className="min-h-10" disabled={!dirty || pending !== null} aria-busy={pending === "save"} aria-describedby={notice ? "substates-save-status" : undefined} onClick={requestSave}>
            {pending === "save" && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending === "save" ? "Guardando…" : "Guardar subestados"}
          </Button>
        </div>
        <ActionStatusSlot>{notice && <ActionStatus id="substates-save-status" tone={dirty && notice.text === "Guardado" ? "info" : notice.tone} text={dirty && notice.text === "Guardado" ? "Cambios sin guardar" : notice.text} action={statusAction} />}</ActionStatusSlot>
      </SheetFooter>
      <Dialog open={confirmingDiscard} onOpenChange={setConfirmingDiscard}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>¿Descartar los cambios de subestados?</DialogTitle>
            <DialogDescription>Los subestados que no guardaste se perderán. Las columnas no cambian.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-10" onClick={() => setConfirmingDiscard(false)}>Seguir editando</Button>
            <Button type="button" variant="destructive" className="min-h-10" onClick={() => { if (!busy.current) onOpenChange(false); }}>Descartar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SheetContent>
  </Sheet>;
}
