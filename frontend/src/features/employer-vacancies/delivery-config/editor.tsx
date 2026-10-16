"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Flag, Target } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { loadDraftDeliveryAction, saveDraftDeliveryAction, type DraftDeliveryActionResult } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { adoptSaved, fromDelivery, isDirty, reconcileUncertainSave, setCommitmentDate, setCutoffStageId, setTargetText, toPutBody, validate, type Delivery, type DeliveryState } from "@/features/jobs/drafts/pipeline/delivery-model";
import { DeliveryDateField } from "./date-field";
import { conflictNotice, deliveryFailureNotice, invalidNotice, recoveryLabels, savedNotice, type PipelineNotice } from "./feedback";

type Session = { editor: DeliveryState; etag: string };
const noResponse = (): DraftDeliveryActionResult => ({ ok: false, reason: "no_response", reference: {} });
export function DeliveryEditor({ draftId, delivery, etag, stages }: {
  draftId: string; delivery: Delivery; etag: string; stages: { id: string; name: string }[];
}) {
  const [session, setSession] = useState<Session>(() => ({ editor: fromDelivery(delivery), etag }));
  const current = useRef(session);
  const [pending, setPending] = useState<"save" | "reload" | "check" | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState<PipelineNotice | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [targetTouched, setTargetTouched] = useState(false);
  const [dateRejected, setDateRejected] = useState(false);
  const targetInput = useRef<HTMLInputElement>(null);
  const statusLink = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = session.editor;
  const dirty = isDirty(state);
  const errors = validate(state, stages.map(stage => stage.id)).errors;
  const targetError = attempted || targetTouched ? errors.targetText : undefined;
  const targetMessage = targetError === "not_integer" ? "Escribe un número entero." : targetError === "out_of_range" ? `Usa un número entre 1 y ${state.limits.maxTargetQuantity}.` : undefined;
  const cutoffMessage = attempted && errors.cutoffStageId ? "Elige una columna actual del pipeline." : undefined;
  function replace(editor: DeliveryState, nextEtag = current.current.etag) {
    const next = { editor, etag: nextEtag }; current.current = next; setSession(next);
  }
  function edit(editor: DeliveryState) { if (!busy.current) replace(editor); }
  function resetErrors() { setAttempted(false); setTargetTouched(false); setDateRejected(false); }
  function report(next: PipelineNotice, reference?: { status?: number; code?: string }) {
    setNotice(next);
    const action = next.recovery ? { title: recoveryLabels[next.recovery], onClick: () => { void recover(next.recovery!); } }
      // The toast shortcut follows the status line's real link (same as the substates Sheet).
      : next.link ? { title: next.link.title, onClick: () => { statusLink.current?.click(); } } : undefined;
    notifyActionResult({ key: "delivery-save", type: next.tone, title: next.title, description: next.description,
      ...(next.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}), action });
  }
  function adopt(result: Extract<DraftDeliveryActionResult, { ok: true }>, attemptedState: DeliveryState) {
    replace(adoptSaved(attemptedState, result.delivery), result.etag); resetErrors();
  }
  async function persist() {
    if (busy.current || !isDirty(current.current.editor)) return;
    setAttempted(true);
    const snapshot = current.current;
    const validation = validate(snapshot.editor, stages.map(stage => stage.id));
    if (!validation.ok) {
      report(invalidNotice);
      // Focus the first invalid field in visual order.
      if (validation.errors.cutoffStageId) document.getElementById("delivery-cutoff")?.focus();
      else if (validation.errors.targetText) targetInput.current?.focus();
      else document.getElementById("delivery-date")?.focus();
      return;
    }
    busy.current = true; setPending("save"); setNotice(null);
    const result = await saveDraftDeliveryAction({ draftId, ifMatch: snapshot.etag, body: toPutBody(snapshot.editor) }).catch(noResponse);
    if (!mounted.current) return;
    if (result.ok) {
      adopt(result, snapshot.editor);
      report(result.delivery.version === snapshot.editor.baseline.version ? { tone: "info", title: "No había cambios que guardar", text: "Guardado" } : savedNotice);
    } else {
      if (result.reason === "non_business_date") setDateRejected(true);
      report(deliveryFailureNotice(result.reason), result.reference);
    }
    busy.current = false; setPending(null);
  }
  async function recover(mode: "reload" | "check") {
    if (busy.current || !mounted.current) return;
    busy.current = true; setPending(mode);
    const snapshot = current.current;
    const result = await loadDraftDeliveryAction(draftId).catch(noResponse);
    if (!mounted.current) return;
    if (!result.ok) {
      report({ ...deliveryFailureNotice(result.reason), description: "No pudimos cargar la versión guardada. Tus cambios siguen aquí. Puedes volver a comprobarla; no se enviará otro guardado.", text: "No se pudo cargar · tus cambios siguen aquí", recovery: mode }, result.reference);
    } else if (mode === "reload") {
      replace(fromDelivery(result.delivery), result.etag); resetErrors();
      report({ tone: "info", title: "Versión actual cargada", text: "Versión actual cargada", description: "El editor muestra los datos de entrega guardados actualmente." });
    } else {
      const outcome = reconcileUncertainSave(snapshot.editor, result.delivery);
      if (outcome === "saved") { adopt(result, snapshot.editor); report(savedNotice); }
      else if (outcome === "not_saved") report({ tone: "info", title: "No se guardó la entrega", text: "No se guardó. Puedes guardar de nuevo; es seguro.", description: "Tus cambios siguen aquí. Puedes guardar de nuevo; es seguro." });
      else report(conflictNotice);
    }
    busy.current = false; setPending(null);
  }
  const recovery = notice?.recovery;
  const statusAction = recovery ? <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={() => void recover(recovery)}>
    {pending === recovery && <Spinner aria-hidden="true" data-icon="inline-start" />}{recoveryLabels[recovery]}
  </Button> : notice?.link ? <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link ref={statusLink} href={notice.link.href} target="_blank" rel="noopener noreferrer" />}>{notice.link.title}</Button> : undefined;
  const options = [{ value: "undefined", label: "Sin definir" }, ...stages.map(stage => ({ value: stage.id, label: stage.name }))];
  return <Card aria-labelledby="delivery-heading">
    <CardHeader className="border-b">
      <CardTitle><h3 id="delivery-heading">Entrega</h3></CardTitle>
      <CardDescription>Define qué cuenta como entrega de esta vacante y para cuándo te comprometes. Puedes guardar los datos por partes; para publicar harán falta los tres.</CardDescription>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <Field data-invalid={!!cutoffMessage} data-disabled={pending !== null}>
          <FieldLabel htmlFor="delivery-cutoff"><Flag aria-hidden="true" className="size-3.5" />Columna de corte</FieldLabel>
          <Select items={options} value={state.cutoffStageId ?? "undefined"} disabled={pending !== null} onValueChange={value => edit(setCutoffStageId(current.current.editor, value === "undefined" ? null : value))}>
            <SelectTrigger id="delivery-cutoff" className="min-h-10 w-full" aria-invalid={!!cutoffMessage} aria-describedby={`delivery-cutoff-description${cutoffMessage ? " delivery-cutoff-error" : ""}`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value} className="min-h-10">{option.label}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <FieldDescription id="delivery-cutoff-description">Un candidato cuenta como entregado cuando llega a esta columna.</FieldDescription>
          {cutoffMessage && <FieldError id="delivery-cutoff-error">{cutoffMessage}</FieldError>}
        </Field>
        <Field data-invalid={!!targetMessage} data-disabled={pending !== null}>
          <FieldLabel htmlFor="delivery-target"><Target aria-hidden="true" className="size-3.5" />Objetivo de entrega</FieldLabel>
          <Input id="delivery-target" ref={targetInput} type="text" inputMode="numeric" className="min-h-10" value={state.targetText} disabled={pending !== null}
            onChange={event => edit(setTargetText(current.current.editor, event.target.value))} onBlur={() => setTargetTouched(true)} aria-invalid={!!targetMessage} aria-describedby={`delivery-target-description${targetMessage ? " delivery-target-error" : ""}`} />
          <FieldDescription id="delivery-target-description">Cuántos candidatos distintos tienes que entregar (1 a {state.limits.maxTargetQuantity}).</FieldDescription>
          {targetMessage && <FieldError id="delivery-target-error">{targetMessage}</FieldError>}
        </Field>
        <DeliveryDateField state={state} disabled={pending !== null} error={dateRejected ? "non_business_day" : errors.commitmentDate}
          onChange={value => { if (!busy.current) { edit(setCommitmentDate(current.current.editor, value)); setDateRejected(false); } }} />
      </FieldGroup>
    </CardContent>
    <CardFooter className="flex-col items-stretch gap-2 border-t">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-10" disabled={!dirty || pending !== null} onClick={() => { edit(fromDelivery(current.current.editor.baseline)); resetErrors(); setNotice(null); }}>Descartar cambios</Button>
        <Button type="button" className="min-h-10" disabled={!dirty || pending !== null} aria-busy={pending === "save"} aria-describedby={notice ? "delivery-save-status" : undefined} onClick={() => void persist()}>
          {pending === "save" && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending === "save" ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
      <ActionStatusSlot>{notice && <ActionStatus id="delivery-save-status" tone={dirty && notice.text === "Guardado" ? "info" : notice.tone} text={dirty && notice.text === "Guardado" ? "Cambios sin guardar" : notice.text} action={statusAction} />}</ActionStatusSlot>
    </CardFooter>
  </Card>;
}
