"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import type { Scope } from "../model";
import { acceptOf, formatsHint, sizeLabel } from "./format";

/** The file picker: `accept` from `limits.formats`; `error` is the client pre-check or the server's `fields.file`. */
export function FileField({ limits, onFile, error, disabled }: { limits: Scope["limits"]; onFile: (file: File | null) => void; error: string | null; disabled?: boolean }) {
  const id = useId();
  return <div className="flex flex-col gap-2">
    <label htmlFor={id} className="text-sm font-medium">Archivo</label>
    <Input id={id} type="file" accept={acceptOf(limits)} disabled={disabled} className="h-11 py-2" aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
      onChange={event => onFile(event.target.files?.[0] ?? null)} />
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">{formatsHint(limits)} · máximo {sizeLabel(limits.max_bytes)} por archivo.</p>
    {error && <p id={`${id}-error`} role="alert" className="text-sm text-status-danger">{error}</p>}
  </div>;
}
