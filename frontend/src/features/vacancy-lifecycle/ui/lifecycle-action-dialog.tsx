"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CirclePause, Play, CircleCheck, RotateCcw, Archive } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Field, FieldSet, FieldLegend, FieldGroup, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Item, ItemGroup, ItemContent, ItemTitle, ItemActions, ItemSeparator } from "@/components/ui/item";
import { groupMissing, MISSING_GROUP_LABELS } from "@/features/jobs/drafts/pipeline/publication-model";
import { getLifecycleAction, transitionLifecycleAction, type LifecycleActionResult, type LifecycleTransitionActionInput } from "../actions";
import { closeBodySchema, closeNoteLength, closeCoverageMessage, closeReasonLabel, type CloseReason, type CloseCoverage, type Lifecycle, type LifecycleAction } from "../model";
import { Textarea } from "@/components/ui/textarea";
import type { LifecycleActionFailure } from "../failure";

export type TransitionAction = Exclude<LifecycleAction, "publish">;
export type LifecycleSnapshot = Extract<LifecycleActionResult, { ok: true }>;
export const LIFECYCLE_ACTION_UI = {
  pause: { label: "Pausar", icon: CirclePause, description: "Se oculta del listado y deja de recibir postulaciones. El tablero sigue funcionando." },
  resume: { label: "Reanudar", icon: Play, description: "Vuelve a aparecer en el listado y a recibir postulaciones. El proceso sigue como estaba." },
  close: { label: "Cerrar", icon: Archive, description: "Deja de aparecer en el listado y de recibir postulaciones. Elige qué pasa con el proceso interno." },
  finish_process: { label: "Finalizar proceso", icon: CircleCheck, description: "El tablero queda en solo lectura y los candidatos activos verán «Vacante cerrada»." },
  reopen: { label: "Reabrir", icon: RotateCcw, description: "Vuelve a publicarse tal como quedó. Se conservan el pipeline, los candidatos y el historial; el proceso vuelve a estar activo." },
} as const;
const SUCCESS_TITLES = { pause: "Vacante pausada", resume: "Vacante reanudada", close: "Vacante cerrada", finish_process: "Proceso finalizado", reopen: "Vacante reabierta" } as const;
type Props = { coverage?: CloseCoverage; draftId: string; title: string; action: TransitionAction; snapshot: LifecycleSnapshot; open: boolean; onOpenChange: (open: boolean) => void; onChanged: (view: Lifecycle) => void };

/** A mounted session owns one confirmed intent, including its exact retry headers/body. */
// Dark mode makes the outline toggle's pressed background nearly invisible on a dialog:
// the chosen option also gets a primary border and a check.
const CLOSE_CHOICES = [
  { value: "continue", label: "Seguir con el proceso", description: "El tablero sigue funcionando; puedes finalizarlo después." },
  { value: "finish", label: "Finalizar el proceso", description: "El tablero queda en solo lectura y los candidatos activos verán «Vacante cerrada»." },
] as const;

export function LifecycleActionDialog(props: Props) {
  return props.open ? <ActionSession key={`${props.draftId}-${props.action}`} {...props} /> : null;
}
function ActionSession({ draftId, title, action, snapshot, coverage, onOpenChange, onChanged }: Props) {
  const [reason, setReason] = useState<CloseReason | null>(null);
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<{ field: "reason" | "note"; message: string } | null>(null);
  const [rejectedCoverage, setRejectedCoverage] = useState<CloseCoverage>();
  const [freshSnapshot, setFreshSnapshot] = useState<LifecycleSnapshot>();
  const currentSnapshot = freshSnapshot ?? snapshot;
  const currentCoverage = rejectedCoverage ?? coverage;
  const filledDisabled = !!currentCoverage && (currentCoverage.required === null || currentCoverage.covered < currentCoverage.required);
  const reasonGroup = useRef<HTMLDivElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  function focusReason() { reasonGroup.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }
  const [process, setProcess] = useState<"continue" | "finish">("continue");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<LifecycleActionFailure | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const intent = useRef<LifecycleTransitionActionInput | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const ui = LIFECYCLE_ACTION_UI[action];
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function report(result: LifecycleActionFailure) {
    setFailure(result);
    notifyActionResult({ key: `lifecycle-${draftId}`, type: "error", title: result.message, description: "Revisa el estado antes de continuar.", reference: { ...result.reference, at: new Date().toISOString() } });
  }
  async function check() {
    if (lock.current) return;
    lock.current = true; setPending(true);
    try {
      const result = await getLifecycleAction(draftId);
      if (!alive.current) return;
      if (result.ok) {
        onChanged(result.data);
        // Only an unchanged lifecycle permits replay of the SAME intent. Never refresh its ETag.
        if (result.etag === intent.current?.ifMatch && result.data.allowed_actions.includes(action)) setRetryReady(true);
        else { setFailure({ ok: false, reason: "lifecycle_transition_invalid", message: "Estado actualizado. Revisa las acciones disponibles.", reference: {} }); setRetryReady(false); }
      } else report(result);
    } catch { if (alive.current) report({ ok: false, reason: "no_response", uncertain: true, message: "No pudimos consultar el estado. Vuelve a comprobarlo.", reference: {} }); }
    finally { lock.current = false; if (alive.current) setPending(false); }
  }
  async function confirm() {
    if (lock.current || !currentSnapshot.data.allowed_actions.includes(action)) return;
    if (!intent.current) {
      if (action === "close") {
        if (!reason || (reason === "filled" && filledDisabled)) {
          setFieldError({ field: "reason", message: reason && currentCoverage ? closeCoverageMessage(currentCoverage) : "Elige un motivo de cierre." }); focusReason(); return;
        }
        const body = closeBodySchema.safeParse({ process, reason, reason_note: reason === "other" ? note : null });
        if (!body.success) { setFieldError({ field: "note", message: "Escribe un motivo de hasta 200 caracteres." }); noteInput.current?.focus(); return; }
        intent.current = { draftId, ifMatch: currentSnapshot.etag, idempotencyKey: crypto.randomUUID(), action, body: body.data };
      } else intent.current = { draftId, ifMatch: currentSnapshot.etag, idempotencyKey: crypto.randomUUID(), action, body: {} };
    }
    lock.current = true; setPending(true); setRetryReady(false);
    try {
      const result = await transitionLifecycleAction(intent.current);
      if (!alive.current) return;
      if (result.ok) {
        notifyActionResult({ key: `lifecycle-${draftId}`, type: "success", title: SUCCESS_TITLES[action], description: action === "close" ? intent.current.body.process === "finish" ? "El proceso finalizó y el tablero quedó en solo lectura." : "El proceso continúa y el tablero sigue funcionando." : ui.description });
        onChanged(result.data); onOpenChange(false);
      } else {
        if (result.reason === "close_reason_not_covered") {
          setRejectedCoverage(result.coverage);
          setFieldError({ field: "reason", message: result.message });
          setReason(null); intent.current = null;
          notifyActionResult({ key: `lifecycle-${draftId}`, type: "error", title: "No se cerró la vacante", description: result.message, reference: { ...result.reference, at: new Date().toISOString() } });
        } else report(result);
        if (result.lifecycle) onChanged(result.lifecycle);
        if (result.reload) {
          const latest = await getLifecycleAction(draftId);
          if (alive.current) { if (latest.ok) { setFreshSnapshot(latest); onChanged(latest.data); } else report(latest); }
        }
      }
    } catch { if (alive.current) report({ ok: false, reason: "no_response", uncertain: true, message: "No pudimos confirmar si se aplicó la acción. Comprueba el estado.", reference: {} }); }
    finally { lock.current = false; if (alive.current) setPending(false); }
  }
  if (failure) return <Dialog open onOpenChange={open => { if (!pending) onOpenChange(open); }}>
    <DialogContent initialFocus={heading} showCloseButton={!pending} className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col sm:max-w-lg">
      <DialogHeader><DialogTitle ref={heading} tabIndex={-1}>{failure.missing ? "Te falta para publicar" : "Revisa el estado de la vacante"}</DialogTitle><DialogDescription>{failure.missing ? "Completa los requisitos y vuelve a elegir la acción." : failure.message}</DialogDescription></DialogHeader>
      {failure.missing && <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">{groupMissing(failure.missing).map(group => <section key={group.group} className="flex shrink-0 flex-col gap-2"><h3 className="text-sm font-medium">{MISSING_GROUP_LABELS[group.group]}</h3><ItemGroup className="gap-0 has-data-[size=sm]:gap-0 has-data-[size=xs]:gap-0">{group.items.map((item, index) => <Fragment key={`${item.code}-${index}`}>
        {index > 0 && <ItemSeparator className="my-0" />}<Item size="xs" role="listitem"><ItemContent><ItemTitle>{item.label}</ItemTitle></ItemContent><ItemActions><Button nativeButton={false} role="link" variant="ghost" render={<Link href={item.href(draftId)} onClick={() => onOpenChange(false)} />}>Completar<span className="sr-only"> {item.label}</span></Button></ItemActions></Item>
      </Fragment>)}</ItemGroup></section>)}</div>}
      <DialogFooter><ActionBar status={pending ? <ActionStatus id={`lifecycle-status-${draftId}`} tone="info" text="Consultando…" /> : null}>
        <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>{failure.missing ? "Volver" : "Cerrar"}</Button>
        {failure.uncertain && <Button disabled={pending} onClick={() => void (retryReady ? confirm() : check())}>{retryReady ? "Reintentar" : "Comprobar"}</Button>}
      </ActionBar></DialogFooter>
    </DialogContent>
  </Dialog>;
  return <ConfirmActionDialog open onOpenChange={onOpenChange} onConfirm={() => void confirm()} icon={ui.icon} title={action === "finish_process" ? `¿Finalizar el proceso de ${title}?` : `¿${ui.label} ${title}?`} description={ui.description} confirmLabel={action === "close" ? "Cerrar vacante" : ui.label} pendingLabel="Aplicando…" pending={pending} confirmDisabled={!currentSnapshot.data.allowed_actions.includes(action)} finalFocus={() => heading.current ?? true} tone={action === "finish_process" || (action === "close" && process === "finish") ? "destructive" : "default"}>
    {action === "close" && <FieldGroup>
      <FieldSet><FieldLegend>Motivo de cierre</FieldLegend><Field data-invalid={fieldError?.field === "reason" || undefined}>
        <ToggleGroup ref={reasonGroup} aria-label="Motivo de cierre" aria-required="true" aria-invalid={fieldError?.field === "reason" || undefined} aria-describedby={fieldError?.field === "reason" ? "close-reason-error" : filledDisabled ? "close-coverage" : undefined} variant="outline" className="grid w-full grid-cols-1 sm:grid-cols-3" value={reason ? [reason] : []} disabled={pending} onValueChange={values => { const value = values[0]; if (value === "filled" || value === "cancelled" || value === "other") { setReason(value); setFieldError(null); } }}>
          {(["filled", "cancelled", "other"] as const).map(value => <ToggleGroupItem key={value} value={value} disabled={pending || (value === "filled" && filledDisabled)} className="min-h-10">{closeReasonLabel(value)}</ToggleGroupItem>)}
        </ToggleGroup>
        {fieldError?.field === "reason" ? <FieldError id="close-reason-error">{fieldError.message}</FieldError> : filledDisabled && currentCoverage && <FieldDescription id="close-coverage">{closeCoverageMessage(currentCoverage)}</FieldDescription>}
      </Field></FieldSet>
      {reason === "other" && <Field data-invalid={fieldError?.field === "note" || undefined}>
        <FieldLabel htmlFor="close-note">Motivo</FieldLabel>
        <Textarea ref={noteInput} id="close-note" required value={note} disabled={pending} aria-invalid={fieldError?.field === "note" || undefined} aria-describedby={fieldError?.field === "note" ? "close-note-error close-note-count" : "close-note-count"} onChange={event => { setNote(event.target.value); setFieldError(null); }} />
        <FieldDescription id="close-note-count">{closeNoteLength(note)} / 200 caracteres</FieldDescription>
        {fieldError?.field === "note" && <FieldError id="close-note-error">{fieldError.message}</FieldError>}
      </Field>}
      <FieldSet><FieldLegend>Proceso interno</FieldLegend><Field><ToggleGroup aria-label="Proceso interno al cerrar" variant="outline" orientation="vertical" className="w-full" value={[process]} onValueChange={values => { if (values[0] === "continue" || values[0] === "finish") setProcess(values[0]); }} disabled={pending}>
      {CLOSE_CHOICES.map(choice => <ToggleGroupItem key={choice.value} value={choice.value} aria-label={choice.label} className={`h-auto min-h-10 flex-col items-start gap-1 py-2 text-left whitespace-normal ${process === choice.value ? "border-primary" : ""}`}>
        <span className="flex w-full items-center justify-between gap-2 font-medium">{choice.label}{process === choice.value && <CircleCheck data-pf-close-choice-check aria-hidden="true" className="text-primary" />}</span>
        <span className="text-xs font-normal text-muted-foreground">{choice.description}</span>
      </ToggleGroupItem>)}
    </ToggleGroup></Field></FieldSet></FieldGroup>}
  </ConfirmActionDialog>;
}
