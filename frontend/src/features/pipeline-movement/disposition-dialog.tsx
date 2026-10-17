"use client";
import { useRef, useState } from "react";
import { ListChecks, MessageSquare, NotebookPen, RotateCcw, TriangleAlert, UserRoundX } from "lucide-react";
import { cn } from "cn";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { buildDiscardBody, discardCatalog, validateDiscardText } from "./discard-text";
import type { Notice } from "./board-feedback";
import type { Board, DiscardBody, DiscardReason } from "./model";
import type { Disposition } from "./use-movement-board";

type Props = {
  disposition: Disposition; board: Board; pending: boolean; stale: boolean; reading: boolean; notice?: Notice;
  onClose: () => void; onConfirm: (body?: DiscardBody) => void; finalFocus: () => HTMLElement | null;
};
const options = discardCatalog.flatMap(group => group.reasons.map(reason => ({ value: `${group.group}:${reason.key}`, label: reason.label, reason: { group: group.group, key: reason.key } as DiscardReason })));
function textError(error: ReturnType<typeof validateDiscardText>["error"], limit: number) {
  return error === "required" ? "Explica el motivo en el comentario." : error === "too_long" ? `Usa como máximo ${limit} caracteres.` : error === "control_character" ? "Quita los caracteres de control; puedes usar saltos de línea y tabulaciones." : null;
}
export function DispositionDialog({ disposition, board, pending, stale, reading, notice, onClose, onConfirm, finalFocus }: Props) {
  const [choice, setChoice] = useState<string | null>(null);
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
  const previous = board.stages.find(stage => stage.id === disposition.item.discard?.previous_stage_id);
  const stage = board.stages.find(stage => stage.id === disposition.item.stage_id);
  const statusId = `disposition-status-${disposition.item.id}`;
  function confirm() {
    if (!discarding) { onConfirm(); return; }
    setAttempted(true);
    if (!reason) { reasonControl.current?.focus(); return; }
    if (internal.error) { commentControl.current?.focus(); return; }
    if (candidate.error) { messageControl.current?.focus(); return; }
    onConfirm(buildDiscardBody(reason, comment, message));
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={!pending} finalFocus={finalFocus} className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-[520px]">
      <DialogHeader><div className={cn("mb-3 flex size-10 items-center justify-center rounded-xl", discarding ? "bg-status-danger/10 text-status-danger" : "bg-status-info/10 text-status-info")}>{discarding ? <UserRoundX aria-hidden="true" className="size-5" /> : <RotateCcw aria-hidden="true" className="size-5" />}</div><DialogTitle>{discarding ? "Descartar candidato" : "Recuperar candidato"}</DialogTitle><DialogDescription>{discarding ? "Registra el motivo del descarte. El motivo y el comentario interno no se comparten con el candidato." : `Volverá a ${previous?.name ?? "su etapa anterior"}. Se conservará el historial y el mensaje dejará de verse en sus postulaciones.`}</DialogDescription></DialogHeader>
      <p className="font-medium">{disposition.item.candidate.full_name}</p>
      {disposition.placementConfirmation && <p className="flex items-start gap-2 text-sm"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" />{discarding ? `Salir de ${stage?.name ?? "Placement"} reduce las plazas cubiertas y registra una salida; conserva el historial de contratación y los hitos de cobertura.` : `Volver a ${previous?.name ?? "Placement"} implica volver a ocupar una plaza y registrar una nueva contratación. Confirma esta consecuencia.`}</p>}
      {discarding && <FieldGroup>
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
      </FieldGroup>}
      <DialogFooter className="flex-row bg-transparent"><ActionBar status={pending ? <span role="status" className="text-sm">Guardando…</span> : stale ? <ActionStatus id={statusId} tone="info" text={reading ? "Actualizando el tablero. Espera antes de confirmar." : "Cancela y usa Reintentar para actualizar el tablero antes de confirmar."} /> : notice ? <ActionStatus id={statusId} tone={notice.tone} text={notice.text} /> : null}>
        <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={onClose}>Cancelar</Button>
        <Button type="button" variant={discarding ? "destructive" : "default"} className="min-h-10" disabled={pending || stale || reading} aria-busy={pending} aria-describedby={stale || notice ? statusId : undefined} onClick={confirm}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{discarding ? "Confirmar descarte" : "Confirmar recuperación"}</Button>
      </ActionBar></DialogFooter>
    </DialogContent>
  </Dialog>;
}
