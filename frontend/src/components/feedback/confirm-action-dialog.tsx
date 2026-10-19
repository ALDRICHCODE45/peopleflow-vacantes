"use client";

import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean, details?: unknown) => void;
  onConfirm: () => void;
  /** Names the action and its subject: «¿Mover a Ana Pérez a Screening?». */
  title: string;
  /** States the consequence in plain language, never repeating the title. */
  description: string;
  /** Verb of the action: «Mover», «Descartar candidato». Never «Aceptar» or «Sí». */
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  tone?: "default" | "destructive";
  /** Optional details or fields the decision needs (summary, reason, message). */
  children?: ReactNode;
};

/**
 * Last step before an important action (§18): an AlertDialog that names the action,
 * states its consequence and requires an explicit confirm. Focus starts on «Cancelar»
 * so a stray Enter or double click cannot confirm; both buttons lock while pending.
 */
export function ConfirmActionDialog({
  open, onOpenChange, onConfirm, title, description, confirmLabel, pendingLabel, pending = false, tone = "default", children,
}: ConfirmActionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next, details) => { if (!pending) onOpenChange(next, details); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus className="min-h-10" disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="min-h-10"
            variant={tone === "destructive" ? "destructive" : "default"}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() => { if (!pending) onConfirm(); }}
          >
            {pending && <Spinner aria-hidden="true" data-icon="inline-start" />}
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
