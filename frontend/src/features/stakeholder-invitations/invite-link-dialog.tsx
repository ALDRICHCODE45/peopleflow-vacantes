"use client";

import * as React from "react";
import { Check, Copy, Link2, TriangleAlert } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { formatDay, formatTime } from "./format";

type Props = { url: string; expiresAt: string; onClose: () => void };

/**
 * Shown once, right after the API creates the invitation: the link cannot be read again (the API keeps only a hash).
 * The dialog never closes by itself, and copying reports a refusal instead of pretending it worked.
 */
export function InviteLinkDialog({ url, expiresAt, onClose }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const statusId = React.useId();
  const [copy, setCopy] = React.useState<"idle" | "copied" | "failed">("idle");
  async function copyLink() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      setCopy("failed");
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Link2 /></span>
        <DialogTitle>Copia el enlace ahora</DialogTitle>
        <DialogDescription>Por seguridad no lo volveremos a mostrar. Envíalo por WhatsApp o chat a la persona que quieres invitar. Sirve una sola vez y vence el {formatDay(expiresAt)} a las {formatTime(expiresAt)}.</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="stakeholder-invite-link">Enlace de invitación</FieldLabel>
        <InputGroup className="h-10">
          <InputGroupInput ref={inputRef} id="stakeholder-invite-link" readOnly value={url} className="tabular-nums" onFocus={event => event.currentTarget.select()} aria-describedby={copy === "idle" ? undefined : statusId} />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="button" className="min-h-8" aria-describedby={copy === "idle" ? undefined : statusId} onClick={() => void copyLink()}>
              {copy === "copied" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copy === "copied" ? "Copiado" : "Copiar enlace"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <ActionStatusSlot>
          {copy === "copied" && <ActionStatus id={statusId} tone="success" text="Enlace copiado. Pégalo en el mensaje para la persona invitada." />}
          {copy === "failed" && <ActionStatus id={statusId} tone="error" text="No se pudo copiar. El enlace quedó seleccionado: cópialo con Ctrl+C." />}
        </ActionStatusSlot>
      </Field>
      <p className="flex gap-2.5 rounded-xl bg-status-review/10 p-3 text-sm text-foreground">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-review" />
        <span>Quien use este enlace verá las métricas de toda la empresa y los nombres de candidatos en el detalle auditado.</span>
      </p>
      <DialogFooter>
        <Button type="button" className="min-h-10" onClick={onClose}>Listo, ya lo copié</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
