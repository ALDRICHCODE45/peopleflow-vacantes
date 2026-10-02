"use client";

import * as React from "react";
import { LayoutDashboardIcon, MailIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { VACANCY_PIPELINE_STAGES } from "./model";
import { CANDIDATE_STATUS_LABELS } from "./pipeline-model";
import type { CandidateStatus } from "./pipeline-model";
import {
  PIPELINE_MESSAGE_MAX_LENGTH,
  createPipelineNotificationDraft,
  pipelineNotificationPreview,
  pipelineStageTransition,
  validatePipelineNotification,
  type PipelineNotificationDraft,
} from "./pipeline-move-model";

/**
 * Confirmation of one pending pipeline movement. It owns exactly one decision:
 * the destination stage and, optionally, a message prepared for the candidate.
 *
 * The dialog is mounted per pending move, so a fresh movement always starts from
 * a fresh draft. Nothing here sends, stores or claims a delivery: the preview
 * describes the intended email and application-process channels, and the visible
 * note states that this local prototype delivers neither.
 */

const MESSAGE_HINT_ID = "pipeline-move-message-hint";
const MESSAGE_ERROR_ID = "pipeline-move-message-error";
const NOTIFY_HINT_ID = "pipeline-move-notify-hint";
const QA = "text-[12.5px] text-muted-foreground";

export type PipelineMoveDialogProps = {
  candidateName: string;
  vacancyTitle: string;
  /** Stage the candidate holds right now. */
  from: CandidateStatus;
  /** Stage the drop or menu action asked for; the initial selection. */
  to: CandidateStatus;
  onCancel: () => void;
  onConfirm: (confirmed: {
    to: CandidateStatus;
    notification: PipelineNotificationDraft;
  }) => void;
};

export function PipelineMoveDialog({
  candidateName,
  vacancyTitle,
  from,
  to,
  onCancel,
  onConfirm,
}: PipelineMoveDialogProps) {
  const [stage, setStage] = React.useState<CandidateStatus>(to);
  const [draft, setDraft] = React.useState(createPipelineNotificationDraft);
  const [showError, setShowError] = React.useState(false);

  const messageError = validatePipelineNotification(draft);
  const shownError = showError ? messageError : undefined;
  const preview = pipelineNotificationPreview({
    vacancyTitle,
    to: stage,
    message: draft.message.trim(),
  });
  const sameStage = stage === from;

  /** Every edit invalidates the previous attempt, so the error never goes stale. */
  function updateDraft(next: PipelineNotificationDraft) {
    setDraft(next);
    setShowError(false);
  }

  function handleConfirm() {
    // An invalid draft keeps the dialog open on its own explanation; the change
    // stays pending until the message is valid or the notification is removed.
    if (messageError !== undefined) {
      setShowError(true);
      return;
    }
    if (sameStage) return;
    onConfirm({ to: stage, notification: draft });
  }

  return (
    <Dialog
      open
      onOpenChange={(next: boolean) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={false}
        data-pf-pipeline-move-dialog=""
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Confirmar cambio de etapa</DialogTitle>
          <DialogDescription>
            Revisa el movimiento de {candidateName} en {vacancyTitle} antes de confirmarlo.
          </DialogDescription>
        </DialogHeader>

        <p
          data-pf-pipeline-move-summary={to}
          className="rounded-xl bg-muted p-3 text-sm"
        >
          <span className="sr-only">Cambio de etapa: </span>
          <span className="font-semibold text-foreground">
            {pipelineStageTransition(from, stage)}
          </span>
        </p>

        <FieldSet data-pf-pipeline-stage-choice className="gap-2">
          <FieldLegend variant="label" className="mb-0">
            Etapa destino
          </FieldLegend>
          <ToggleGroup
            aria-label="Etapa destino"
            variant="outline"
            size="sm"
            value={[stage]}
            onValueChange={(next: string[]) => {
              // Base UI empties the selection when the active item is toggled
              // off; the pending movement always keeps one destination.
              const [nextStage] = next;
              if (nextStage === undefined) return;
              setStage(nextStage as CandidateStatus);
            }}
            className="flex-wrap"
          >
            {VACANCY_PIPELINE_STAGES.map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                data-pf-pipeline-stage-option={value}
                className="focus-visible:ring-3"
              >
                {CANDIDATE_STATUS_LABELS[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {sameStage ? (
            <FieldDescription data-pf-pipeline-same-stage="">
              {candidateName} ya está en esta etapa; elige otra para continuar.
            </FieldDescription>
          ) : null}
        </FieldSet>

        <Field orientation="horizontal" data-pf-pipeline-notify="" className="items-start">
          <FieldContent>
            <FieldLabel htmlFor="pipeline-move-notify">
              Notificar a la persona candidata
            </FieldLabel>
            <FieldDescription id={NOTIFY_HINT_ID}>
              Opcional. Prepara un mensaje para su correo y para el panel de su proceso.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="pipeline-move-notify"
            checked={draft.enabled}
            aria-describedby={NOTIFY_HINT_ID}
            data-pf-pipeline-notify-switch=""
            onCheckedChange={(checked: boolean) =>
              updateDraft({ ...draft, enabled: checked })
            }
          />
        </Field>

        {draft.enabled ? (
          <FieldGroup data-pf-pipeline-message="" className="gap-4">
            <Field data-invalid={shownError === undefined ? undefined : true}>
              <FieldLabel htmlFor="pipeline-move-message">
                Mensaje para la persona candidata
              </FieldLabel>
              <Textarea
                id="pipeline-move-message"
                data-pf-pipeline-message-input=""
                value={draft.message}
                maxLength={PIPELINE_MESSAGE_MAX_LENGTH}
                rows={4}
                aria-invalid={shownError === undefined ? undefined : true}
                aria-describedby={
                  shownError === undefined
                    ? MESSAGE_HINT_ID
                    : `${MESSAGE_HINT_ID} ${MESSAGE_ERROR_ID}`
                }
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  updateDraft({ ...draft, message: event.target.value })
                }
              />
              <FieldDescription id={MESSAGE_HINT_ID}>
                {`Opcional · máximo ${PIPELINE_MESSAGE_MAX_LENGTH} caracteres.`}
              </FieldDescription>
              <FieldError id={MESSAGE_ERROR_ID} data-pf-pipeline-message-error="">
                {shownError}
              </FieldError>
            </Field>

            <div
              data-pf-pipeline-preview=""
              className="flex flex-col gap-3 rounded-xl bg-muted p-3"
            >
              <p className="text-sm font-semibold text-foreground">
                Vista previa de la notificación
              </p>
              <div data-pf-pipeline-preview-email="" className="flex flex-col gap-1">
                <p className={`flex items-center gap-1.5 ${QA}`}>
                  <MailIcon aria-hidden="true" className="size-3.5" />
                  Correo
                </p>
                <p className="text-sm text-foreground">
                  Para:{" "}
                  {preview.emailRecipient ?? "No disponible en este prototipo local"}
                </p>
                <p className="text-sm text-foreground">Asunto: {preview.emailSubject}</p>
                <p className="text-sm whitespace-pre-wrap break-words text-foreground">
                  {preview.emailBody === "" ? "Sin mensaje" : preview.emailBody}
                </p>
              </div>
              <div data-pf-pipeline-preview-process="" className="flex flex-col gap-1">
                <p className={`flex items-center gap-1.5 ${QA}`}>
                  <LayoutDashboardIcon aria-hidden="true" className="size-3.5" />
                  Panel de proceso
                </p>
                <p className="text-sm text-foreground">{preview.processEntry}</p>
                <p className="text-sm whitespace-pre-wrap break-words text-foreground">{preview.processMessage || "Sin mensaje"}</p>
              </div>
              <p data-pf-pipeline-demo-note="" className={`text-balance ${QA}`}>
                Demostración local: no se envía ningún correo ni se actualiza el panel de la
                persona candidata.
              </p>
            </div>
          </FieldGroup>
        ) : null}

        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline" className="h-10" data-pf-pipeline-move-cancel="" />
            }
          >
            Cancelar
          </DialogClose>
          <Button
            type="button"
            className="h-10"
            data-pf-pipeline-move-confirm=""
            disabled={sameStage}
            onClick={handleConfirm}
          >
            Confirmar movimiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
