"use client";

import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ICONS } from "../../model";
import { SITE_ICONS } from "../../public/site-icons";
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
export const ICON_LABELS: Record<typeof ICONS[number], string> = {
  heart: "Corazón", users: "Equipo", rocket: "Cohete", target: "Objetivo", lightbulb: "Idea", shield: "Protección", leaf: "Naturaleza", globe: "Mundo", "graduation-cap": "Aprendizaje", briefcase: "Trabajo", laptop: "Computadora", clock: "Tiempo", calendar: "Calendario", coffee: "Café", dumbbell: "Ejercicio", stethoscope: "Salud", "piggy-bank": "Ahorro", gift: "Regalo", plane: "Viajes", home: "Casa", sparkles: "Inspiración", handshake: "Colaboración", trophy: "Reconocimiento", smile: "Bienestar",
};
export function IconField({ value, onChange, error }: { value: typeof ICONS[number]; onChange: (value: typeof ICONS[number]) => void; error?: string }) {
  const id = useId(); const Current = SITE_ICONS[value];
  return <Field data-invalid={!!error}><FieldLabel htmlFor={id}>Ícono</FieldLabel>
    <Select value={value} onValueChange={next => { if (ICONS.includes(next as typeof value)) onChange(next as typeof value); }}>
      <SelectTrigger id={id} className="min-h-10 w-full" aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}><Current aria-hidden="true" /><SelectValue>{ICON_LABELS[value]}</SelectValue></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}><TooltipProvider><SelectGroup className="grid grid-cols-3 gap-1">{ICONS.map(icon => { const Icon = SITE_ICONS[icon]; return <Tooltip key={icon}><TooltipTrigger render={<SelectItem value={icon} aria-label={ICON_LABELS[icon]} className="min-h-10" />}><Icon aria-hidden="true" /><span className="sr-only">{ICON_LABELS[icon]}</span></TooltipTrigger><TooltipContent>{ICON_LABELS[icon]}</TooltipContent></Tooltip>; })}</SelectGroup></TooltipProvider></SelectContent>
    </Select>
    <FieldDescription id={`${id}-help`}>Elige el símbolo que mejor represente esta idea.</FieldDescription>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}
