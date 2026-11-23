import type { DocumentFormat, Scope } from "../model";

/** Presentation helpers of the Documentos tab. Sizes, formats and counts come from the backend (`scope.limits`), never from constants here. */
export const FORMAT_LABEL: Record<DocumentFormat, string> = { pdf: "PDF", docx: "Word", xlsx: "Excel", jpg: "JPG", png: "PNG" };
const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });

export function sizeLabel(bytes: number): string {
  if (bytes >= 1_048_576) {
    const mb = bytes / 1_048_576;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1).replace(".", ",")} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
export const dateLabel = (value: string): string => dateFormat.format(new Date(value));
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** `accept` of the file input: every extension of `limits.formats`. */
export const acceptOf = (limits: Scope["limits"]): string => limits.formats.flatMap(format => format.extensions).join(",");
/** «PDF (.pdf), Word (.docx)…» for the upload hint, from the same list. */
export const formatsHint = (limits: Scope["limits"]): string => limits.formats.map(format => `${FORMAT_LABEL[format.format]} (${format.extensions.join(", ")})`).join(", ");

/** Client pre-check of a chosen file against the live `limits`; the backend still inspects the content. `null` = nothing to say. */
export function checkFile(file: File, limits: Scope["limits"]): string | null {
  if (file.size === 0) return "El archivo está vacío. Elige otro.";
  const extension = /\.[^./\\]+$/.exec(file.name)?.[0].toLowerCase() ?? "";
  if (!limits.formats.some(format => format.extensions.includes(extension))) return `No aceptamos archivos ${extension || "sin extensión"}. Formatos permitidos: ${formatsHint(limits)}.`;
  if (file.size > limits.max_bytes) return `${file.name} pesa ${sizeLabel(file.size)} y el máximo es ${sizeLabel(limits.max_bytes)}.`;
  return null;
}
/** Where a source document comes from: sequence 0 is the original process, then «Reemplazo n». */
export const originLabel = (sequence: number): string => sequence === 0 ? "Proceso original" : `Reemplazo ${sequence}`;
