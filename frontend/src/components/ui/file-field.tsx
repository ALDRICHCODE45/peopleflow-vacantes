"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "cn";
import { AlertCircle, CloudUpload, File as FileIcon, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Choose a file (artboard `design/choice-and-file-controls/03`): an input-group field with an «Elegir archivo» button, and once chosen a
 * document card with «Cambiar» / «Quitar». Replaces the bare `<input type="file">` («Browse… No file selected.», `design/system.md`).
 * The native input stays in the DOM, labelled and described, but visually hidden; the button and a drop onto the field both feed it.
 * It rejects nothing itself: `accept` only filters the browser's picker, validation and `error` stay with the caller.
 */
export type FileFieldProps = {
  value: File | null;
  onChange: (file: File | null) => void;
  label?: ReactNode;
  /** Formats and maximum size, always visible and announced with the input. */
  hint?: ReactNode;
  accept?: string;
  error?: ReactNode;
  disabled?: boolean;
  /** The file-type tile of the card; the default is the extension on a neutral tile. */
  badge?: (file: File) => ReactNode;
  /** The line under the name; the default is «PDF · 179 KB». */
  meta?: (file: File) => ReactNode;
  className?: string;
};

const extensionOf = (file: File) => /\.([^./\\]+)$/.exec(file.name)?.[1].toUpperCase() ?? "";
function bytesLabel(bytes: number): string {
  if (bytes >= 1_048_576) { const mb = bytes / 1_048_576; return `${Number.isInteger(mb) ? mb : mb.toFixed(1).replace(".", ",")} MB`; }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
const defaultBadge = (file: File) => <span aria-hidden="true" data-pf-file-badge="" className="grid size-12 shrink-0 place-items-center rounded-xl border bg-muted text-xs font-semibold text-muted-foreground">{extensionOf(file).slice(0, 4) || <FileIcon className="size-5" />}</span>;
const defaultMeta = (file: File) => [extensionOf(file), bytesLabel(file.size)].filter(Boolean).join(" · ");

export function FileField({ value, onChange, label = "Archivo", hint, accept, error, disabled, badge = defaultBadge, meta = defaultMeta, className }: FileFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const [dragging, setDragging] = useState(false);
  // Clearing must also clear the native value: choosing the same file again fires no change event otherwise.
  useEffect(() => { if (value === null && input.current) input.current.value = ""; }, [value]);
  // «Quitar» unmounts the card that held focus (it would fall to the dialog): move it to «Elegir archivo» once that renders.
  useEffect(() => { if (value === null && refocus.current) { refocus.current = false; choose.current?.focus(); } }, [value]);

  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const pick = () => input.current?.click();
  const drag = (event: DragEvent, on: boolean) => {
    if (disabled || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault(); setDragging(on);
  };
  function drop(event: DragEvent) {
    if (disabled) return;
    event.preventDefault(); setDragging(false);
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) onChange(dropped);
  }

  return <div className={cn("flex flex-col gap-2", className)}>
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <input ref={input} id={id} type="file" accept={accept} disabled={disabled} tabIndex={-1} className="sr-only" aria-invalid={error ? true : undefined} aria-describedby={describedBy}
      onChange={event => onChange(event.target.files?.[0] ?? null)} />
    {value ? <div role="group" aria-label="Archivo elegido" data-slot="file-field-zone" data-drag={dragging || undefined}
      onDragEnter={event => drag(event, true)} onDragOver={event => drag(event, true)} onDragLeave={event => drag(event, false)} onDrop={drop}
      className={cn("flex gap-3.5 rounded-2xl bg-card p-4 shadow-[0_0_0_1px_var(--border)] data-[drag=true]:bg-primary/9 data-[drag=true]:shadow-[0_0_0_2px_var(--selection)]", error && "shadow-[0_0_0_1.5px_var(--destructive)]")}>
      {badge(value)}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-semibold [overflow-wrap:anywhere]">{value.name}</span>
        <span className="text-xs text-muted-foreground">{meta(value)}</span>
        <div className="-mb-2 -ml-2.5 mt-1 flex flex-wrap gap-1 max-sm:[&>button]:min-h-11 max-sm:[&>button]:flex-1">
          <Button type="button" variant="ghost" className="min-h-10" disabled={disabled} onClick={pick}><RefreshCw aria-hidden="true" />Cambiar</Button>
          <Button type="button" variant="ghost" className="min-h-10 text-status-danger hover:bg-status-danger/10 hover:text-status-danger" disabled={disabled} onClick={() => { refocus.current = true; onChange(null); }}><X aria-hidden="true" />Quitar</Button>
        </div>
      </div>
    </div> : <div data-slot="file-field-zone" data-drag={dragging || undefined}
      onDragEnter={event => drag(event, true)} onDragOver={event => drag(event, true)} onDragLeave={event => drag(event, false)} onDrop={drop}
      className={cn("flex min-h-14 flex-wrap items-center gap-3 rounded-2xl bg-input/50 p-2 data-[drag=true]:bg-primary/9 data-[drag=true]:shadow-[0_0_0_2px_var(--selection)]", error && "bg-destructive/6 shadow-[0_0_0_1.5px_var(--destructive)]", disabled && "opacity-60")}>
      <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-card text-muted-foreground shadow-[0_0_0_1px_var(--border)] [&>svg]:size-5", dragging && "bg-selection text-selection-foreground shadow-none", error && "text-status-danger")}>
        {error ? <AlertCircle /> : dragging ? <CloudUpload /> : <FileIcon />}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{dragging ? "Suelta el archivo para elegirlo" : <><span className="sm:hidden">Elige un archivo</span><span className="hidden sm:inline">Arrastra un archivo o elígelo</span></>}</span>
        {hint && <span id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Button ref={choose} type="button" variant="outline" className="min-h-10 shrink-0 max-sm:min-h-11 max-sm:basis-full" disabled={disabled} aria-describedby={describedBy} onClick={pick}><Upload aria-hidden="true" />Elegir archivo</Button>
    </div>}
    {value && hint && <span id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</span>}
    {error && <p id={`${id}-error`} role="alert" className="flex items-start gap-1.5 text-sm text-status-danger"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{error}</p>}
  </div>;
}
