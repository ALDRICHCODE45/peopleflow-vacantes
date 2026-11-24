"use client";

import * as React from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { NOTE_MAX_LENGTH, parseNote } from "./model";

type Props = {
  pending: boolean;
  /** How many times the API rejected the note (400 validation_error on `note`); each one shows the field error again. */
  noteRejections: number;
  onSubmit: (note: string | undefined) => void;
  onClose: () => void;
};

const NOTE_ERRORS = {
  too_long: `Usa ${NOTE_MAX_LENGTH} caracteres o menos.`,
  control: "Quita los saltos de línea y otros caracteres no imprimibles.",
  server: `La nota no es válida. Escribe entre 1 y ${NOTE_MAX_LENGTH} caracteres, sin saltos de línea.`,
} as const;

/**
 * Step before the one-time link (D11): an optional «Para quién es» label so the owner can tell pending invitations apart.
 * Blank sends nothing. The note is validated like the API does (trimmed, 1..80, no control characters).
 */
export function CreateInvitationDialog({ pending, noteRejections, onSubmit, onClose }: Props) {
  const id = React.useId();
  const [value, setValue] = React.useState("");
  const [clientError, setClientError] = React.useState<keyof typeof NOTE_ERRORS | null>(null);
  const [showServerError, setShowServerError] = React.useState(false);
  React.useEffect(() => { if (noteRejections > 0) setShowServerError(true); }, [noteRejections]);
  const error = clientError ? NOTE_ERRORS[clientError] : showServerError ? NOTE_ERRORS.server : null;
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = parseNote(value);
    if (!parsed.ok) { setClientError(parsed.reason); setShowServerError(false); return; }
    setClientError(null); setShowServerError(false);
    onSubmit(parsed.note);
  }
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <DialogHeader>
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Link2 /></span>
          <DialogTitle>Nueva invitación</DialogTitle>
          <DialogDescription>Crearemos un enlace de un solo uso que vence en 7 días. Si quieres, anota para quién es y lo reconocerás en la lista de invitaciones pendientes.</DialogDescription>
        </DialogHeader>
        <Field data-invalid={error !== null}>
          <FieldLabel htmlFor={id}>Para quién es (opcional)</FieldLabel>
          <Input id={id} value={value} autoComplete="off" placeholder="Ej. Luis Pérez, Dirección" aria-invalid={error !== null} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            onChange={event => { setValue(event.target.value); setClientError(null); setShowServerError(false); }} />
          <FieldDescription id={`${id}-help`}>Hasta {NOTE_MAX_LENGTH} caracteres. Solo lo ves tú y las demás personas dueñas.</FieldDescription>
          {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="min-h-10" disabled={pending} aria-busy={pending}>
            {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Creando enlace…" : "Crear enlace"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
