"use client";

import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean, details?: unknown) => void;
  onConfirm: () => void;
  /** Icon of the action, shown as the official AlertDialogMedia in the header. */
  icon: LucideIcon;
  /** Names the action and its subject: «¿Mover a Ana Pérez a Screening?». */
  title: string;
  /** States the consequence in plain language, never repeating the title. */
  description: string;
  /** Verb of the action: «Mover», «Descartar candidato». Never «Aceptar» or «Sí». */
  confirmLabel: string;
  /** Cancel wording when «Cancelar» does not name the safe choice (e.g. «Continuar editando»). */
  cancelLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  tone?: "default" | "destructive";
  /** Blocks only the confirm button (e.g. while the data reloads); «Cancelar» stays usable. */
  confirmDisabled?: boolean;
  /** Element that receives focus when the dialog closes (the card or control that opened it). */
  finalFocus?: ComponentProps<typeof AlertDialogContent>["finalFocus"];
  /** Optional details or fields the decision needs (summary, reason, message), placed in one
   * details slot between header and footer. Without details the dialog uses size="sm". */
  children?: ReactNode;
};

/**
 * Last step before an important action (§18), built with the official shadcn composition
 * (Content → Header[Media, Title, Description] → Footer[Cancel, Action]): an AlertDialog that names the action,
 * states its consequence and requires an explicit confirm. Focus starts on «Cancelar»
 * so a stray Enter or double click cannot confirm; both buttons lock while pending.
 */
export function ConfirmActionDialog({
  open, onOpenChange, onConfirm, icon: Icon, title, cancelLabel = "Cancelar", description, confirmLabel, pendingLabel, pending = false, tone = "default", confirmDisabled = false, finalFocus, children,
}: ConfirmActionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next, details) => { if (!pending) onOpenChange(next, details); }}>
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogMedia className={tone === "destructive" ? "bg-destructive/10 text-destructive dark:bg-destructive/20" : "bg-primary/10 text-primary"}>
            <Icon aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children && <div data-slot="confirm-action-details" className="-mx-1 flex max-h-[calc(100dvh-16rem)] min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain px-1 [scrollbar-width:thin]">{children}</div>}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus className="min-h-10" disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className="min-h-10"
            variant={tone === "destructive" ? "destructive" : "default"}
            disabled={pending || confirmDisabled}
            aria-busy={pending || undefined}
            onClick={() => { if (!pending && !confirmDisabled) onConfirm(); }}
          >
            {pending && <Spinner aria-hidden="true" data-icon="inline-start" />}
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
