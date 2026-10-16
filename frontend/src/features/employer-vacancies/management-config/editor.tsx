"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { loadDraftManagementAction, saveDraftManagementAction, type DraftManagementActionResult } from "@/features/jobs/drafts/pipeline/management-actions";
import { adoptSaved, fromManagement, isDirty, reconcileUncertainSave, setHeadcountText, setRequestDate, toPutBody, validate, type Management, type ManagementState } from "@/features/jobs/drafts/pipeline/management-model";
import { ManagementDateField } from "./date-field";
import { conflictNotice, managementFailureNotice, invalidNotice, recoveryLabels, savedNotice, type PipelineNotice } from "./feedback";

type Session = { editor: ManagementState; etag: string };
const noResponse = (): DraftManagementActionResult => ({ ok: false, reason: "no_response", reference: {} });
export function ManagementEditor({ draftId, management, etag }: { draftId: string; management: Management; etag: string }) {
  const [session, setSession] = useState<Session>(() => ({ editor: fromManagement(management), etag }));
  const current = useRef(session);
  const [pending, setPending] = useState<"save" | "reload" | "check" | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState<PipelineNotice | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [headcountTouched, setHeadcountTouched] = useState(false);
  const headcountInput = useRef<HTMLInputElement>(null);
  const statusLink = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = session.editor;
  const dirty = isDirty(state);
  const errors = validate(state).errors;
  const headcountError = attempted || headcountTouched ? errors.headcountText : undefined;
  const headcountMessage = headcountError === "not_integer" ? "Escribe un número entero." : headcountError === "out_of_range" ? `Usa un número entre 1 y ${state.limits.maxHiringHeadcount}.` : undefined;
  function replace(editor: ManagementState, nextEtag = current.current.etag) {
    const next = { editor, etag: nextEtag }; current.current = next; setSession(next);
  }
  function edit(editor: ManagementState) { if (!busy.current) replace(editor); }
  function resetErrors() { setAttempted(false); setHeadcountTouched(false); }
  function report(next: PipelineNotice, reference?: { status?: number; code?: string }) {
    setNotice(next);
    const action = next.recovery ? { title: recoveryLabels[next.recovery], onClick: () => { void recover(next.recovery!); } }
      : next.link ? { title: next.link.title, onClick: () => { statusLink.current?.click(); } } : undefined;
    notifyActionResult({ key: "management-save", type: next.tone, title: next.title, description: next.description,
      ...(next.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}), action });
  }
  function adopt(result: Extract<DraftManagementActionResult, { ok: true }>, attemptedState: ManagementState) {
    replace(adoptSaved(attemptedState, result.management), result.etag); resetErrors();
  }
  async function persist() {
    if (busy.current || !isDirty(current.current.editor)) return;
    setAttempted(true);
    const snapshot = current.current;
    const validation = validate(snapshot.editor);
    if (!validation.ok) {
      report(invalidNotice);
      // Date is first in visual order; never focus a fixed field on validation.
      if (validation.errors.requestDate) document.getElementById("management-date")?.focus();
      else headcountInput.current?.focus();
      return;
    }
    busy.current = true; setPending("save"); setNotice(null);
    const result = await saveDraftManagementAction({ draftId, ifMatch: snapshot.etag, body: toPutBody(snapshot.editor) }).catch(noResponse);
    if (!mounted.current) return;
    if (result.ok) {
      adopt(result, snapshot.editor);
      report(result.management.version === snapshot.editor.baseline.version ? { tone: "info", title: "No había cambios que guardar", text: "Guardado" } : savedNotice);
    } else report(managementFailureNotice(result.reason), result.reference);
    busy.current = false; setPending(null);
  }
  async function recover(mode: "reload" | "check") {
    if (busy.current || !mounted.current) return;
    busy.current = true; setPending(mode);
    const snapshot = current.current;
    const result = await loadDraftManagementAction(draftId).catch(noResponse);
    if (!mounted.current) return;
    if (!result.ok) {
      report({ ...managementFailureNotice(result.reason), description: "No pudimos cargar la versión guardada. Tus cambios siguen aquí. Puedes volver a comprobarla; no se enviará otro guardado.", text: "No se pudo cargar · tus cambios siguen aquí", recovery: mode }, result.reference);
    } else if (mode === "reload") {
      replace(fromManagement(result.management), result.etag); resetErrors();
      report({ tone: "info", title: "Versión actual cargada", text: "Versión actual cargada", description: "El editor muestra los datos de solicitud guardados actualmente." });
    } else {
      const outcome = reconcileUncertainSave(snapshot.editor, result.management);
      if (outcome === "saved") { adopt(result, snapshot.editor); report(savedNotice); }
      else if (outcome === "not_saved") report({ tone: "info", title: "No se guardó la solicitud", text: "No se guardó. Puedes guardar de nuevo; es seguro.", description: "Tus cambios siguen aquí. Puedes guardar de nuevo; es seguro." });
      else report(conflictNotice);
    }
    busy.current = false; setPending(null);
  }
  const recovery = notice?.recovery;
  const statusAction = recovery ? <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={() => void recover(recovery)}>
    {pending === recovery && <Spinner aria-hidden="true" data-icon="inline-start" />}{recoveryLabels[recovery]}
  </Button> : notice?.link ? <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link ref={statusLink} href={notice.link.href} target="_blank" rel="noopener noreferrer" />}>{notice.link.title}</Button> : undefined;
  return <Card aria-labelledby="management-heading">
    <CardHeader className="border-b">
      <CardTitle><h3 id="management-heading">Solicitud</h3></CardTitle>
      <CardDescription>Datos internos de la solicitud. Los candidatos nunca los ven. Hacen falta para publicar.</CardDescription>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <ManagementDateField state={state} disabled={pending !== null} error={errors.requestDate} onChange={value => edit(setRequestDate(current.current.editor, value))} />
        <Field data-invalid={!!headcountMessage} data-disabled={pending !== null}>
          <FieldLabel htmlFor="management-headcount"><Users aria-hidden="true" className="size-3.5" />Plazas a cubrir</FieldLabel>
          <Input id="management-headcount" ref={headcountInput} type="text" inputMode="numeric" className="min-h-10" value={state.headcountText} disabled={pending !== null}
            onChange={event => edit(setHeadcountText(current.current.editor, event.target.value))} onBlur={() => setHeadcountTouched(true)} aria-invalid={!!headcountMessage} aria-describedby={`management-headcount-description${headcountMessage ? " management-headcount-error" : ""}`} />
          <FieldDescription id="management-headcount-description">Cuántas personas hay que contratar (1 a {state.limits.maxHiringHeadcount}). Es independiente del objetivo de entrega.</FieldDescription>
          {headcountMessage && <FieldError id="management-headcount-error">{headcountMessage}</FieldError>}
        </Field>
      </FieldGroup>
    </CardContent>
    <CardFooter className="border-t">
      <ActionBar status={notice && <ActionStatus id="management-save-status" tone={dirty && notice.text === "Guardado" ? "info" : notice.tone} text={dirty && notice.text === "Guardado" ? "Cambios sin guardar" : notice.text} action={statusAction} />}>
        <Button type="button" variant="ghost" className="min-h-10" disabled={!dirty || pending !== null} onClick={() => { edit(fromManagement(current.current.editor.baseline)); resetErrors(); setNotice(null); }}>Descartar cambios</Button>
        <Button type="button" className="min-h-10" disabled={!dirty || pending !== null} aria-busy={pending === "save"} aria-describedby={notice ? "management-save-status" : undefined} onClick={() => void persist()}>
          {pending === "save" && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending === "save" ? "Guardando…" : "Guardar cambios"}
        </Button>
      </ActionBar>
    </CardFooter>
  </Card>;
}
