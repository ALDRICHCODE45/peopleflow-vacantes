"use client";

import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MappedFieldError } from "../../editor-state";

export function fieldMessage(errors: MappedFieldError[], blockId: string, path: string): string | undefined {
  const issue = errors.find(error => error.blockId === blockId && error.field === path);
  if (!issue) return undefined;
  switch (issue.code) {
    case "too_long": return "Acorta este texto.";
    case "required": return "Completa este campo.";
    case "duplicate": return "Este dato está repetido.";
    case "not_allowed": return "Este dato no está permitido.";
    default: return "Revisa este dato.";
  }
}
export function Counter({ count, max }: { count: number; max: number }) {
  return <Badge variant={count > max ? "danger" : count >= Math.ceil(max * .9) ? "review" : "secondary"} aria-label={`${count} de ${max} caracteres`}>{count}/{max}</Badge>;
}
export type TextFieldProps = { label: string; value: string | null; onChange: (value: string | null) => void; max: number; description: string; error?: string; multiline?: boolean; url?: boolean };
export function TextField({ label, value, onChange, max, description, error, multiline, url }: TextFieldProps) {
  const id = useId(); const count = [...(value ?? "").trim()].length;
  const message = error ?? (count > max ? `Usa hasta ${max} caracteres.` : undefined);
  const props = { id, value: value ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value || null), "aria-invalid": !!message, "aria-describedby": `${id}-help${message ? ` ${id}-error` : ""}`, className: "min-h-10" };
  // No DOM maxLength: the wire contract counts code points, not UTF-16 units.
  // Keep over-limit pasted text editable instead of silently destroying it.
  return <Field data-invalid={!!message}><FieldLabel htmlFor={id}>{label}</FieldLabel>
    {multiline ? <Textarea {...props} rows={3} className="field-sizing-content min-h-[calc(3lh+1rem)] max-h-[calc(10lh+1rem)] resize-none overflow-y-auto" /> : <Input {...props} inputMode={url ? "url" : undefined} />}
    <div className="flex flex-wrap items-start justify-between gap-2"><FieldDescription id={`${id}-help`} className="min-w-0 flex-1">{description}</FieldDescription><Counter count={count} max={max} /></div>
    {message && <FieldError id={`${id}-error`}>{message}</FieldError>}
  </Field>;
}
