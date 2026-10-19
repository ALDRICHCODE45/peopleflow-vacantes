"use client";
import { useMemo, useRef, useState } from "react";
import { BadgeCheck, ListChecks, MessageSquare, NotebookPen, Undo2, UserX } from "lucide-react";
import { ActionStatus } from "@/components/feedback/action-status";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { buildDiscardBody, discardCatalog, validateDiscardText } from "./discard-text";
import type { Notice } from "./board-feedback";
import type { Board, DiscardBody, DiscardReason, RecoverBody } from "./model";
import { recoverySelection } from "./recovery";
import type { Disposition } from "./use-movement-board";

type Props = {
  disposition: Disposition; board: Board; pending: boolean; stale: boolean; reading: boolean; notice?: Notice;
  onClose: () => void; onConfirm: (body?: DiscardBody | RecoverBody) => void; finalFocus: () => HTMLElement | null;
};
const options = discardCatalog.flatMap(group => group.reasons.map(reason => ({ value: `${group.group}:${reason.key}`, label: reason.label, reason: { group: group.group, key: reason.key } as DiscardReason })));
function textError(error: ReturnType<typeof validateDiscardText>["error"], limit: number) {
  return error === "required" ? "Explica el motivo en el comentario." : error === "too_long" ? `Usa como máximo ${limit} caracteres.` : error === "control_character" ? "Quita los caracteres de control; puedes usar saltos de línea y tabulaciones." : null;
}
export function DispositionDialog({ disposition, board, pending, stale, reading, notice, onClose, onConfirm, finalFocus }: Props) {
  const [choice, setChoice] = useState<string | null>(null);
  const [returnChoice, setReturnChoice] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const reasonControl = useRef<HTMLButtonElement>(null);
  const commentControl = useRef<HTMLTextAreaElement>(null);
  const messageControl = useRef<HTMLTextAreaElement>(null);
  const reason = options.find(option => option.value === choice)?.reason;
  const internal = validateDiscardText(comment, 1000, reason?.key === "other");
  const candidate = validateDiscardText(message, 500);
  const internalError = attempted ? textError(internal.error, 1000) : null;
  const candidateError = attempted ? textError(candidate.error, 500) : null;
  const discarding = disposition.kind === "discard";
  const previous = [...board.stages, ...board.retired_stages].find(stage => stage.id === disposition.item.discard?.previous_stage_id);
  const recovery = recoverySelection(board, disposition.item, disposition.recoveryRequired);
  const returnStage = recovery.stages.some(stage => stage.id === returnChoice) ? returnChoice : recovery.defaultId;
  const defaultId = recovery.defaultId;
  const returnOptions = useMemo(() => {
    const index = board.stages.findIndex(stage => stage.id === defaultId);
    return board.stages.slice(0, index + 1).map(stage => ({ value: stage.id, label: `${stage.name}${stage.id === defaultId ? " (sugerida)" : ""}` }));
  }, [board.stages, defaultId]);
  const statusId = `disposition-status-${disposition.item.id}`;
  function confirm() {
    if (!discarding) {
      if (recovery.required) {
        if (!returnStage || !recovery.stages.some(stage => stage.id === returnStage)) return;
        onConfirm({ to_stage_id: returnStage });
      } else onConfirm();
      return;
    }
    setAttempted(true);
    if (!reason) { reasonControl.current?.focus(); return; }
    if (internal.error) { commentControl.current?.focus(); return; }
    if (candidate.error) { messageControl.current?.focus(); return; }
    onConfirm(buildDiscardBody(reason, comment, message));
  }
  const consequence = discarding
    ? "Su postulación pasa a Finalizada. El motivo y el comentario interno no se comparten con el candidato."
    : recovery.required
      ? `Su columna anterior, «${previous?.name ?? "Columna eliminada"}», ya no existe. Elige dónde regresar; se conserva el historial y el mensaje deja de verse en sus postulaciones.`
      : `Vuelve a ${previous?.name ?? "su etapa anterior"}. Se conserva el historial y el mensaje deja de verse en sus postulaciones.`;
  const coverage = !disposition.placementConfirmation ? "" : discarding
    ? " Las plazas cubiertas disminuyen en una y se conserva el historial de contratación y los hitos de cobertura."
    : " Vuelve a ocupar una plaza y se registra una nueva contratación.";
  const feedback = stale ? <ActionStatus id={statusId} tone="info" text={reading ? "Actualizando el tablero. Espera antes de confirmar." : "Cancela y usa Reintentar para actualizar el tablero antes de confirmar."} /> : notice ? <ActionStatus id={statusId} tone={notice.tone} text={notice.text} /> : null;
  return <ConfirmActionDialog icon={discarding ? UserX : disposition.placementConfirmation ? BadgeCheck : Undo2} open onOpenChange={open => { if (!open) onClose(); }} finalFocus={finalFocus}
    title={`¿${discarding ? "Descartar" : "Recuperar"} a ${disposition.item.candidate.full_name}?`} description={consequence + coverage}
    confirmLabel={discarding ? "Descartar candidato" : "Recuperar"} pendingLabel={discarding ? "Descartando…" : "Recuperando…"}
    tone={discarding ? "destructive" : "default"} pending={pending} confirmDisabled={stale || reading || (!discarding && recovery.required && !recovery.stages.some(stage => stage.id === returnStage))} onConfirm={confirm}>
      {discarding ? <><FieldGroup>
        <Field data-invalid={attempted && !reason} data-disabled={pending}>
          <FieldLabel htmlFor="discard-reason"><ListChecks aria-hidden="true" className="size-3.5" />Motivo</FieldLabel>
          <Select items={options} value={choice} onValueChange={setChoice} disabled={pending}>
            <SelectTrigger id="discard-reason" ref={reasonControl} className="min-h-10 w-full" aria-invalid={attempted && !reason} aria-describedby={attempted && !reason ? "discard-reason-error" : undefined}><SelectValue placeholder="Elige un motivo" /></SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>{discardCatalog.map(group => <SelectGroup key={group.group}><SelectLabel>{group.label}</SelectLabel>{group.reasons.map(reason => <SelectItem className="min-h-10" key={reason.key} value={`${group.group}:${reason.key}`}>{reason.label}</SelectItem>)}</SelectGroup>)}</SelectContent>
          </Select>
          {attempted && !reason && <FieldError id="discard-reason-error">Elige un motivo.</FieldError>}
        </Field>
        <Field data-invalid={!!internalError} data-disabled={pending}>
          <div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="discard-comment"><NotebookPen aria-hidden="true" className="size-3.5" />Comentario interno{reason?.key === "other" ? " (obligatorio)" : " (opcional)"}</FieldLabel><FieldDescription id="discard-comment-count" className="shrink-0 text-xs tabular-nums">{internal.count} / 1000</FieldDescription></div>
          <Textarea className="min-h-24 resize-none" placeholder="Agrega contexto para tu equipo…" id="discard-comment" ref={commentControl} disabled={pending} value={comment} onChange={event => setComment(event.target.value)} aria-invalid={!!internalError} aria-describedby={`discard-comment-count${internalError ? " discard-comment-error" : ""}`} />
          <FieldError id="discard-comment-error">{internalError}</FieldError>
        </Field>
        <Field data-invalid={!!candidateError} data-disabled={pending}>
          <div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="discard-message"><MessageSquare aria-hidden="true" className="size-3.5" />Mensaje para el candidato (opcional)</FieldLabel><FieldDescription id="discard-message-count" className="shrink-0 text-xs tabular-nums">{candidate.count} / 500</FieldDescription></div>
          <Textarea className="min-h-24 resize-none" placeholder="Escribe un mensaje para el candidato…" id="discard-message" ref={messageControl} disabled={pending} value={message} onChange={event => setMessage(event.target.value)} aria-invalid={!!candidateError} aria-describedby={`discard-message-help discard-message-count${candidateError ? " discard-message-error" : ""}`} />
          <FieldDescription id="discard-message-help">El candidato verá «Finalizada» y este mensaje, nunca el motivo ni el comentario interno. No se enviará una notificación.</FieldDescription>
          <FieldError id="discard-message-error">{candidateError}</FieldError>
        </Field>
      </FieldGroup>{feedback}</> : recovery.required ? <>
        <FieldGroup><Field data-disabled={pending}>
          <FieldLabel htmlFor="recovery-stage">Columna de regreso</FieldLabel>
          <Select items={returnOptions} value={returnStage} onValueChange={setReturnChoice} disabled={pending} required>
            <SelectTrigger id="recovery-stage" className="min-h-10 w-full" aria-required="true"><SelectValue placeholder="Elige una columna" /></SelectTrigger>
            <SelectContent alignItemWithTrigger={false}><SelectGroup>{returnOptions.map(option => <SelectItem key={option.value} value={option.value} className="min-h-10">{option.label}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field></FieldGroup>
        {feedback}
      </> : feedback}
  </ConfirmActionDialog>;
}
