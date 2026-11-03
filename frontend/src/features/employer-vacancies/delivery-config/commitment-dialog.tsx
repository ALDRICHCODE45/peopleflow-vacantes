"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { loadDraftDeliveryAction, renegotiateDraftCommitmentAction, type DraftDeliveryActionResult } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { commitmentBodySchema, commitmentNoteLength, commitmentNoteMessage, commitmentReasons, isSelectableDate, type DeliveryState } from "@/features/jobs/drafts/pipeline/delivery-model";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import { BusinessDateField, formatCommitmentDate } from "./date-field";
import { deliveryFailureNotice, recoveryLabels, type PipelineNotice } from "./feedback";

type Saved = Extract<DraftDeliveryActionResult, { ok: true }>;
type Intent = Parameters<typeof renegotiateDraftCommitmentAction>[0];
const noResponse = (): DraftDeliveryActionResult => ({ ok: false, reason: "no_response", reference: {} });

/** One mounted confirmation owns one frozen attempt. An explicit retry reuses its body, ETag and UUID. */
export function CommitmentDialog({ draftId, state, etag, finalFocus, onClose, onSaved, onReloaded, onPendingChange, onFinished }: {
  draftId: string; state: DeliveryState; etag: string; finalFocus: RefObject<HTMLButtonElement | null>;
  onClose: () => void; onSaved: (result: Saved) => void; onReloaded: (result: Saved) => void;
  onPendingChange: (pending: boolean) => void; onFinished: (lifecycle: Lifecycle) => void;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ date?: string; note?: string }>({});
  const [notice, setNotice] = useState<PipelineNotice | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(false);
  const [stale, setStale] = useState(false);
  const intent = useRef<Intent | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const frozen = pending || retry || stale;
  // Rejections arrive while fields are disabled; restore focus only after React enables them.
  useEffect(() => {
    if (frozen) return;
    if (errors.date) document.getElementById("commitment-new-date")?.focus();
    else if (errors.note) noteInput.current?.focus();
  }, [errors, frozen]);
  function report(failure: Exclude<DraftDeliveryActionResult, { ok: true }>) {
    const base = failure.reason === "forbidden"
      ? { ...deliveryFailureNotice(failure), description: "Solo el equipo de la vacante o el dueño de la empresa puede renegociar la fecha. Tus datos siguen aquí." }
      : deliveryFailureNotice(failure);
    const uncertain = ["no_response", "server_error", "unrecognized_response", "precondition_required"].includes(failure.reason);
    const next = uncertain ? { ...base, recovery: undefined, description: "No pudimos confirmar el cambio. Reintentar este mismo intento es seguro; no se duplicará.", text: "Cambio sin confirmar · puedes reintentar" } : base;
    setNotice(next);
    notifyActionResult({ key: "commitment-renegotiation", type: next.tone, title: next.title, description: next.description, ...(next.tone === "error" ? { reference: { ...failure.reference, at: new Date().toISOString() } } : {}) });
    setRetry(uncertain);
    setStale(next.recovery === "reload");
    return uncertain;
  }
  function setBusy(value: boolean) { lock.current = value; setPending(value); onPendingChange(value); }
  async function confirm() {
    if (lock.current || stale) return;
    if (!intent.current) {
      if (!date || !reason) return;
      if (!isSelectableDate(state, date) || date === state.baseline.commitmentDate) {
        setErrors({ date: date === state.baseline.commitmentDate ? "Elige una fecha distinta a la actual." : "Elige un día hábil dentro del próximo año." });
        document.getElementById("commitment-new-date")?.focus(); return;
      }
      const parsed = commitmentBodySchema.safeParse({ commitment_date: date, reason, note });
      if (!parsed.success) { setErrors({ note: commitmentNoteMessage }); noteInput.current?.focus(); return; }
      intent.current = { draftId, ifMatch: etag, idempotencyKey: crypto.randomUUID(), body: parsed.data };
    }
    setBusy(true); setNotice(null); setErrors({});
    const result = await renegotiateDraftCommitmentAction(intent.current).catch(noResponse);
    if (!alive.current) return;
    setBusy(false);
    if (result.ok) { onSaved(result); onClose(); return; }
    if (result.reason === "process_finished") { onFinished(result.lifecycle); onClose(); return; }
    const uncertain = report(result);
    if (!uncertain) intent.current = null;
    if (result.reason === "commitment_note_required") { setErrors({ note: commitmentNoteMessage }); noteInput.current?.focus(); }
    else if (result.reason === "commitment_unchanged" || result.reason === "non_business_date") {
      setErrors({ date: result.reason === "commitment_unchanged" ? "Elige una fecha distinta a la actual." : "Ese día no es hábil. Elige otro." });
      document.getElementById("commitment-new-date")?.focus();
    }
  }
  async function reload() {
    if (lock.current) return;
    setBusy(true);
    const result = await loadDraftDeliveryAction(draftId).catch(noResponse);
    if (!alive.current) return;
    setBusy(false);
    if (!result.ok) { report(result); setStale(true); setRetry(false); return; }
    intent.current = null; setStale(false); setRetry(false); setErrors({}); setNotice(null); onReloaded(result);
  }
  return <ConfirmActionDialog open finalFocus={finalFocus} onOpenChange={open => { if (!open) onClose(); }} icon={CalendarDays}
    title="Renegociar la fecha compromiso" description="Elige la nueva fecha y el motivo del cambio." confirmLabel="Renegociar" pendingLabel="Renegociando…"
    pending={pending} confirmDisabled={!date || !reason || stale || retry} onConfirm={() => void confirm()}>
    <p className="text-sm text-muted-foreground">Fecha actual: {formatCommitmentDate(state.baseline.commitmentDate)}</p>
    <FieldGroup>
      <BusinessDateField id="commitment-new-date" label="Nueva fecha compromiso" description="Elige un día hábil del calendario de la empresa." value={date} calendar={state.calendar}
        disabled={frozen} errorMessage={errors.date} onChange={value => { setDate(value); setErrors({}); }} />
      <Field data-disabled={frozen}>
        <FieldLabel htmlFor="commitment-reason">Motivo</FieldLabel>
        <Select items={commitmentReasons} value={reason} disabled={frozen} onValueChange={value => { setReason(value); setErrors({}); }}>
          <SelectTrigger id="commitment-reason" className="min-h-10 w-full" aria-required="true"><SelectValue placeholder="Elige un motivo" /></SelectTrigger>
          <SelectContent><SelectGroup>{commitmentReasons.map(item => <SelectItem key={item.value} value={item.value} className="min-h-10">{item.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>
      <Field data-invalid={!!errors.note} data-disabled={frozen}>
        <FieldLabel htmlFor="commitment-note">Nota</FieldLabel>
        <Textarea ref={noteInput} id="commitment-note" value={note} required={reason === "other"} disabled={frozen} aria-invalid={!!errors.note}
          aria-describedby={`commitment-note-help${errors.note ? " commitment-note-error" : ""}`} onChange={event => { setNote(event.target.value); setErrors({}); }} />
        <FieldDescription id="commitment-note-help">{reason === "other" ? "Obligatoria para Otro." : "Opcional."} {commitmentNoteLength(note)} / 500 caracteres.</FieldDescription>
        {errors.note && <FieldError id="commitment-note-error">{errors.note}</FieldError>}
      </Field>
    </FieldGroup>
    <p className="text-sm text-muted-foreground">El cambio queda en los movimientos de la vacante.</p>
    <ActionBar status={notice && <ActionStatus id="commitment-status" tone={notice.tone} text={notice.text} />}>
      {retry && <Button type="button" variant="outline" disabled={pending} aria-describedby="commitment-status" onClick={() => void confirm()}>Reintentar</Button>}
      {stale && <Button type="button" variant="outline" disabled={pending} aria-describedby="commitment-status" onClick={() => void reload()}>{recoveryLabels.reload}</Button>}
      {notice?.link && <Button nativeButton={false} role="link" variant="outline" render={<Link href={notice.link.href} target="_blank" rel="noopener noreferrer" />}>{notice.link.title}</Button>}
    </ActionBar>
  </ConfirmActionDialog>;
}
