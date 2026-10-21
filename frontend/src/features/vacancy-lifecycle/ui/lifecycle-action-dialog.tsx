"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CirclePause, Play, CircleCheck, RotateCcw, Square } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Field, FieldSet, FieldLegend } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Item, ItemGroup, ItemContent, ItemTitle, ItemActions, ItemSeparator } from "@/components/ui/item";
import { groupMissing, MISSING_GROUP_LABELS } from "@/features/jobs/drafts/pipeline/publication-model";
import { getLifecycleAction, transitionLifecycleAction, type LifecycleActionResult, type LifecycleTransitionActionInput } from "../actions";
import type { Lifecycle, LifecycleAction } from "../model";
import type { LifecycleActionFailure } from "../failure";

export type TransitionAction = Exclude<LifecycleAction, "publish">;
export type LifecycleSnapshot = Extract<LifecycleActionResult, { ok: true }>;
export const LIFECYCLE_ACTION_UI = {
  pause: { label: "Pausar", icon: CirclePause, description: "Se oculta del listado y deja de recibir postulaciones. El tablero sigue funcionando." },
  resume: { label: "Reanudar", icon: Play, description: "Vuelve a aparecer en el listado y a recibir postulaciones. El proceso sigue como estaba." },
  close: { label: "Cerrar", icon: Square, description: "Deja de aparecer en el listado y de recibir postulaciones. Elige qué pasa con el proceso interno." },
  finish_process: { label: "Finalizar proceso", icon: CircleCheck, description: "El tablero queda en solo lectura y los candidatos activos verán «Vacante cerrada»." },
  reopen: { label: "Reabrir", icon: RotateCcw, description: "Vuelve a publicarse tal como quedó. Se conservan el pipeline, los candidatos y el historial; el proceso vuelve a estar activo." },
} as const;
type Props = { draftId: string; title: string; action: TransitionAction; snapshot: LifecycleSnapshot; open: boolean; onOpenChange: (open: boolean) => void; onChanged: (view: Lifecycle) => void };

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
function ActionSession({ draftId, title, action, snapshot, onOpenChange, onChanged }: Props) {
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
    if (lock.current || !snapshot.data.allowed_actions.includes(action)) return;
    lock.current = true; setPending(true); setRetryReady(false);
    intent.current ??= { draftId, ifMatch: snapshot.etag, idempotencyKey: crypto.randomUUID(), ...(action === "close" ? { action, body: { process } } : { action, body: {} }) };
    try {
      const result = await transitionLifecycleAction(intent.current);
      if (!alive.current) return;
      if (result.ok) {
        notifyActionResult({ key: `lifecycle-${draftId}`, type: "success", title: "Estado de la vacante actualizado", description: ui.description });
        onChanged(result.data); onOpenChange(false);
      } else {
        report(result);
        if (result.lifecycle) onChanged(result.lifecycle);
        if (result.reload) {
          const latest = await getLifecycleAction(draftId);
          if (alive.current) { if (latest.ok) onChanged(latest.data); else report(latest); }
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
  return <ConfirmActionDialog open onOpenChange={onOpenChange} onConfirm={() => void confirm()} icon={ui.icon} title={action === "finish_process" ? `¿Finalizar el proceso de ${title}?` : `¿${ui.label} ${title}?`} description={ui.description} confirmLabel={action === "close" ? "Cerrar vacante" : ui.label} pendingLabel="Aplicando…" pending={pending} confirmDisabled={!snapshot.data.allowed_actions.includes(action)} finalFocus={() => heading.current ?? true} tone={action === "finish_process" || (action === "close" && process === "finish") ? "destructive" : "default"}>
    {action === "close" && <FieldSet><FieldLegend>Proceso interno</FieldLegend><Field><ToggleGroup aria-label="Proceso interno al cerrar" variant="outline" orientation="vertical" className="w-full" value={[process]} onValueChange={values => { if (values[0] === "continue" || values[0] === "finish") setProcess(values[0]); }} disabled={pending}>
      {CLOSE_CHOICES.map(choice => <ToggleGroupItem key={choice.value} value={choice.value} aria-label={choice.label} className={`h-auto min-h-10 flex-col items-start gap-1 py-2 text-left whitespace-normal ${process === choice.value ? "border-primary" : ""}`}>
        <span className="flex w-full items-center justify-between gap-2 font-medium">{choice.label}{process === choice.value && <CircleCheck data-pf-close-choice-check aria-hidden="true" className="text-primary" />}</span>
        <span className="text-xs font-normal text-muted-foreground">{choice.description}</span>
      </ToggleGroupItem>)}
    </ToggleGroup></Field></FieldSet>}
  </ConfirmActionDialog>;
}
