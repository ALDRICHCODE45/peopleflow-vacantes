"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { FieldDescription, FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { loadDraftSubstatesAction, saveDraftSubstatesAction, type DraftSubstatesActionResult } from "@/features/jobs/drafts/pipeline/substates-actions";
import {
  add, adoptSaved, availableSuggestions, canAdd, fromCatalog, isDirty, move, moveTo, reconcileUncertainSave, remove, rename, toPutBody, validate,
  type SubstatesCatalog, type SubstatesEditorState,
} from "@/features/jobs/drafts/pipeline/substates-model";
import { conflictNotice, invalidNotice, recoveryLabels, savedNotice, substatesFailureNotice, type PipelineNotice } from "./feedback";
import { SubstateRow } from "./row";
import { SubstatesReorder } from "./reorder";

type Session = { editor: SubstatesEditorState; etag: string };
const noResponse = (): DraftSubstatesActionResult => ({ ok: false, reason: "no_response", reference: {} });

/** Isolated editing, explicit saves and GET-only reconciliation, like the columns editor. */
export function SubstatesEditor({ draftId, inProcessName, catalog, etag }: { draftId: string; inProcessName: string; catalog: SubstatesCatalog; etag: string }) {
  const [session, setSession] = useState<Session>(() => ({ editor: fromCatalog(catalog), etag }));
  const current = useRef(session);
  const [pending, setPending] = useState<"save" | "reload" | "check" | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState<PipelineNotice | null>(null);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
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
  function report(next: PipelineNotice, reference?: { status?: number; code?: string }) {
    setNotice(next);
    const action = next.recovery ? { title: recoveryLabels[next.recovery], onClick: () => { void recover(next.recovery!); } }
      : next.link ? { title: next.link.title, onClick: () => { statusLink.current?.click(); } } : undefined;
    notifyActionResult({ key: "substates-save", type: next.tone, title: next.title, description: next.description,
      ...(next.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}), action });
  }
  function adopt(response: Extract<DraftSubstatesActionResult, { ok: true }>, attemptedState: SubstatesEditorState) {
    replace(adoptSaved(attemptedState, response.catalog), response.etag); setTouched(new Set()); setAttempted(false);
  }
  async function persist() {
    if (busy.current) return;
    const snapshot = current.current; busy.current = true; setPending("save"); setNotice(null);
    const result = await saveDraftSubstatesAction({ draftId, ifMatch: snapshot.etag, body: toPutBody(snapshot.editor) }).catch(noResponse);
    if (!mounted.current) return;
    if (result.ok) {
      adopt(result, snapshot.editor);
      report(result.catalog.version === snapshot.editor.baseline.version ? { tone: "info", title: "No había cambios que guardar", text: "Guardado" } : savedNotice);
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
      report({ tone: "info", title: "Versión actual cargada", text: "Versión actual cargada", description: "El editor muestra los subestados guardados actualmente." });
    } else {
      const outcome = reconcileUncertainSave(snapshot.editor, result.catalog);
      if (outcome === "saved") { adopt(result, snapshot.editor); report(savedNotice); }
      else if (outcome === "not_saved") report({ tone: "info", title: "No se guardaron los subestados", text: "No se guardó. Puedes guardar de nuevo; es seguro.", description: "Tus cambios siguen aquí. Puedes guardar de nuevo; es seguro." });
      else report(conflictNotice);
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
  const suggestionBlock = suggestions.length > 0 && <section aria-labelledby="substates-suggestions-heading" className="flex flex-col gap-3">
    <h4 id="substates-suggestions-heading" className="font-heading text-base font-medium">Sugerencias</h4>
    <div className="flex flex-wrap gap-2">{suggestions.map(suggestion => <Button key={suggestion} type="button" variant="outline" className="min-h-10 h-auto whitespace-normal text-left" disabled={pending !== null || !canAdd(state)} aria-label={`Agregar ${suggestion}`} onClick={() => addEntry(suggestion)}>
      <Plus aria-hidden="true" data-icon="inline-start" />{suggestion}
    </Button>)}</div>
  </section>;
  const addButton = <div className="flex flex-col items-start gap-2">
    <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null || !canAdd(state)} onClick={() => addEntry()}><Plus aria-hidden="true" data-icon="inline-start" />Agregar subestado</Button>
    {!canAdd(state) && <FieldDescription>Llegaste al máximo de {state.limits.maxSubstates} subestados.</FieldDescription>}
  </div>;
  const recovery = notice?.recovery;
  const statusAction = recovery ? <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={() => void recover(recovery)}>
    {pending === recovery && <Spinner aria-hidden="true" data-icon="inline-start" />}{recoveryLabels[recovery]}
  </Button> : notice?.link ? <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link ref={statusLink} href={notice.link.href} target="_blank" rel="noopener noreferrer" />}>{notice.link.title}</Button> : undefined;
  return <Card aria-labelledby="substates-heading">
    <CardHeader className="border-b has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
      <CardTitle><h3 id="substates-heading">Subestados de {inProcessName}</h3></CardTitle>
      <CardDescription>Úsalos para registrar en qué punto del proceso está cada candidato, por ejemplo cada entrevista. No son pasos obligatorios ni tienen que seguir un orden.</CardDescription>
      <CardAction className="col-start-1 row-span-1 row-start-auto justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end"><Badge variant="neutral">{state.entries.length} de {state.limits.maxSubstates} subestados</Badge></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-5">
      {state.entries.length === 0 ? <Empty className="px-0 sm:px-6">
        <EmptyHeader><EmptyTitle><h4>Todavía no hay subestados</h4></EmptyTitle><EmptyDescription>Agrega un subestado o elige una sugerencia para empezar. Se guardarán cuando elijas Guardar cambios.</EmptyDescription></EmptyHeader>
        <EmptyContent>{suggestionBlock}{addButton}</EmptyContent>
      </Empty> : <>
        <SubstatesReorder state={state} disabled={pending !== null} onMove={(key, target) => edit(moveTo(current.current.editor, key, target))}>
          <ol aria-label="Subestados" className="flex flex-col gap-3">{state.entries.map((entry, index) => <SubstateRow key={entry.key} entry={entry} position={index + 1} state={state} disabled={pending !== null}
            error={attempted || touched.has(entry.key) ? errors[entry.key] : undefined}
            inputRef={node => { if (node) { inputs.current.set(entry.key, node); if (focusOnMount.current === entry.key) { node.focus(); focusOnMount.current = null; } } else inputs.current.delete(entry.key); }}
            onRename={name => edit(rename(current.current.editor, entry.key, name))} onBlur={() => setTouched(previous => new Set(previous).add(entry.key))}
            onMove={direction => edit(move(current.current.editor, entry.key, direction))} onRemove={() => edit(remove(current.current.editor, entry.key))} />)}</ol>
        </SubstatesReorder>
        {addButton}{suggestionBlock}
      </>}
      {errors.$catalog && <FieldError>No puedes guardar más de {state.limits.maxSubstates} subestados.</FieldError>}
    </CardContent>
    <CardFooter className="flex-col items-stretch gap-2 border-t">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-10" disabled={!dirty || pending !== null} onClick={() => { edit(fromCatalog(current.current.editor.baseline)); setTouched(new Set()); setAttempted(false); setNotice(null); }}>Descartar cambios</Button>
        <Button type="button" className="min-h-10" disabled={!dirty || pending !== null} aria-busy={pending === "save"} aria-describedby={notice ? "substates-save-status" : undefined} onClick={requestSave}>
          {pending === "save" && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending === "save" ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
      <ActionStatusSlot>{notice && <ActionStatus id="substates-save-status" tone={dirty && notice.text === "Guardado" ? "info" : notice.tone} text={dirty && notice.text === "Guardado" ? "Cambios sin guardar" : notice.text} action={statusAction} />}</ActionStatusSlot>
    </CardFooter>
  </Card>;
}
