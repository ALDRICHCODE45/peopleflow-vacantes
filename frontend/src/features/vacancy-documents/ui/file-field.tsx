"use client";

import { FileField } from "@/components/ui/file-field";
import type { DocumentFormat, Scope } from "../model";
import { FormatBadge, GhostBadge } from "./format-badge";
import { acceptOf, FORMAT_LABEL, formatsHint, sizeLabel } from "./format";

const formatOf = (file: File, limits: Scope["limits"]): DocumentFormat | null => {
  const extension = /\.[^./\\]+$/.exec(file.name)?.[0].toLowerCase() ?? "";
  return limits.formats.find(format => format.extensions.includes(extension))?.format ?? null;
};

/** The shared `FileField` for Documentos: `accept` and the hint from `limits`, the card badge colored by the format; `error` is the client pre-check or the server's `fields.file`. */
export function DocumentFileField({ limits, file, onFile, error, disabled }: { limits: Scope["limits"]; file: File | null; onFile: (file: File | null) => void; error: string | null; disabled?: boolean }) {
  return <FileField value={file} onChange={onFile} accept={acceptOf(limits)} error={error} disabled={disabled} hint={`${formatsHint(limits)} · máximo ${sizeLabel(limits.max_bytes)} por archivo.`}
    badge={next => { const format = formatOf(next, limits); return format ? <FormatBadge format={format} size="md" /> : <GhostBadge>?</GhostBadge>; }}
    meta={next => { const format = formatOf(next, limits); return `${format ? FORMAT_LABEL[format] : "Formato no admitido"} · ${sizeLabel(next.size)}`; }} />;
}
