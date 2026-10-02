"use client";

import * as React from "react";
import { FileText, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

import {
  APPLICATION_CV_INPUT_ID,
  applicationCvFormatLabel,
  formatApplicationCvSize,
} from "./application-cv";

/**
 * Penultimate public application step: the optional, fully local CV attachment.
 * It composes installed primitives only — a `Card` shell, a `Field` wrapping the
 * native `Input type="file"`, an installed `Button` for the pointer-equivalent
 * picker, and an `Item` for the selected document — and owns just two pieces of
 * view state: the drag highlight and the hidden input ref. It never reads,
 * serializes, stores or uploads a file; the wizard owns the `File | null` value,
 * so leaving or reloading the page loses the selection and the copy says so.
 * Removal is a single named icon action, not a button tray, and replacement is
 * the always-visible drop area, so no contextual menu is warranted.
 */
export type ApplicationCvStepProps = {
  /** The current local selection, owned by the wizard; never persisted. */
  file: File | null;
  /** The Spanish rejection message for the last invalid selection, if any. */
  error: string | null;
  /** Every raw picker or drop selection, valid or not; the wizard validates it. */
  onFiles: (files: readonly File[]) => void;
  /** Clears the current selection; the step then returns focus to the picker button. */
  onRemove: () => void;
  onBack: () => void;
  onContinue: () => void;
  /** The step title, which the wizard focuses after a real step transition. */
  titleRef?: React.Ref<HTMLDivElement>;
};

/** Help and error ids shared by the file control's `aria-describedby`. */
const HELP_ID = "application-cv-help";
const ERROR_ID = "application-cv-error";

/** Dashed drop surface: one baseline treatment, `data-dragging` only reinforces it. */
const DROP =
  "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center transition-colors data-[dragging=true]:border-ring data-[dragging=true]:bg-muted";
/** Circular document medallion: the functional file icon anchors the surface. */
const MEDALLION = "grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary";
/** Every independent action keeps the shared 40px-minimum target. */
const ACTION = "min-h-11";
/** Single selected-document action: a 40px named ghost icon button. */
const REMOVE = "size-10";

export function ApplicationCvStep({
  file,
  error,
  onFiles,
  onRemove,
  onBack,
  onContinue,
  titleRef,
}: ApplicationCvStepProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const dragDepth = React.useRef(0);
  const [dragging, setDragging] = React.useState(false);

  /** The visible button opens the native picker for pointer and keyboard users. */
  function openPicker(): void {
    inputRef.current?.click();
  }

  /** A missing `FileList` is an empty selection, never a crash. */
  function readFiles(list: FileList | null | undefined): readonly File[] {
    return list === null || list === undefined ? [] : Array.from(list);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = readFiles(event.target.files);
    // Clearing the value lets the visitor pick the same file again: the change
    // event only fires when the input value actually changes.
    event.target.value = "";
    onFiles(files);
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>): void {
    // Keeping the default from running is what stops the browser from opening
    // the dropped document in a new tab.
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    onFiles(readFiles(event.dataTransfer?.files));
  }

  function handleRemove(): void {
    onRemove();
    buttonRef.current?.focus();
  }

  const invalid = error !== null;
  const describedBy = invalid ? `${HELP_ID} ${ERROR_ID}` : HELP_ID;

  return (
    <Card data-pf-application-step="cv">
      <CardHeader>
        <CardTitle
          ref={titleRef}
          tabIndex={-1}
          role="heading"
          aria-level={2}
          data-pf-application-step-title
          className="outline-none"
        >
          Tu CV
        </CardTitle>
        <CardDescription>
          Adjunta tu CV si quieres compartirlo con el equipo. Es opcional.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field data-invalid={invalid ? true : undefined}>
          <FieldLabel htmlFor={APPLICATION_CV_INPUT_ID}>
            Curriculum vitae (opcional)
          </FieldLabel>
          <div
            data-pf-application-cv-drop
            data-dragging={dragging ? "true" : "false"}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={DROP}
          >
            <span aria-hidden="true" className={MEDALLION}>
              <FileText className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              {file === null
                ? "Arrastra y suelta tu CV aquí."
                : "Arrastra otro archivo aquí para reemplazar el actual."}
            </p>
            <div className="flex w-full flex-wrap items-center justify-center gap-3">
              {/* Keep native selection behavior without native browser chrome or
                  an invisible tab stop. The Spanish button is the visible control. */}
              <Input
                id={APPLICATION_CV_INPUT_ID}
                ref={inputRef}
                type="file"
                hidden
                tabIndex={-1}
                accept=".pdf,.doc,.docx"
                aria-invalid={invalid ? true : undefined}
                aria-describedby={describedBy}
                onChange={handleChange}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                ref={buttonRef}
                className={ACTION}
                aria-describedby={describedBy}
                onClick={openPicker}
              >
                <Upload aria-hidden="true" data-icon="inline-start" />
                Elegir archivo
              </Button>
            </div>
          </div>
          <FieldDescription id={HELP_ID}>
            Formatos PDF, DOC o DOCX. Tamaño máximo 10 MB. Tu CV se queda en
            esta página: se conserva solo mientras completas el formulario y se
            pierde si recargas o sales. Al iniciar sesión para enviar, tendrás
            que adjuntarlo de nuevo.
          </FieldDescription>
          <FieldError id={ERROR_ID}>{error}</FieldError>
        </Field>

        {file === null ? null : (
          <Item data-pf-application-cv-selected variant="outline">
            <ItemMedia variant="icon">
              <FileText aria-hidden="true" />
            </ItemMedia>
            <ItemContent className="min-w-0">
              {/* The shared ItemTitle clamps to one line; a CV file name is real,
                  arbitrary user data, so it keeps its full readable length here. */}
              <ItemTitle
                data-pf-application-cv-selected-name
                className="line-clamp-none w-full max-w-full break-words"
              >
                {file.name}
              </ItemTitle>
              <ItemDescription>
                {applicationCvFormatLabel(file.name)} · {formatApplicationCvSize(file.size)}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={REMOVE}
                aria-label={`Quitar ${file.name}`}
                onClick={handleRemove}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </ItemActions>
          </Item>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <Button type="button" variant="outline" className={ACTION} onClick={onBack}>
          Atrás
        </Button>
        <Button type="button" className={ACTION} onClick={onContinue}>
          Continuar
        </Button>
      </CardFooter>
    </Card>
  );
}
