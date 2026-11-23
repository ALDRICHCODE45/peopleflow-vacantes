"use client";

import type { ComponentProps, ReactNode } from "react";
import { Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Confirmation of deleting a document or unlinking one (S10). The destructive button is painted with `--status-danger` (~6.5:1) here only:
 * the shared Button `destructive` variant is untouched. A failure stays inside the dialog; focus starts on «Cancelar».
 */
export function DangerConfirmDialog({ open, onOpenChange, title, description, confirmLabel, pending, error, onConfirm, finalFocus, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; confirmLabel: string; pending: boolean; error: string | null;
  onConfirm: () => void; finalFocus?: ComponentProps<typeof AlertDialogContent>["finalFocus"]; children?: ReactNode;
}) {
  return <AlertDialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
    <AlertDialogContent finalFocus={finalFocus}>
      <AlertDialogHeader>
        <AlertDialogMedia className="bg-status-danger/10 text-status-danger"><Trash2 aria-hidden="true" /></AlertDialogMedia>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      {children}
      {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel autoFocus className="min-h-10" disabled={pending}>Cancelar</AlertDialogCancel>
        <Button type="button" className="min-h-10 bg-status-danger text-background hover:bg-status-danger/90 focus-visible:ring-status-danger/30" disabled={pending} aria-busy={pending || undefined} onClick={onConfirm}>
          {pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{confirmLabel}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
