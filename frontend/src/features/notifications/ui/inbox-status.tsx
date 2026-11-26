import { CheckCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { markedAllStatus } from "../copy";
import type { MarkStatus } from "./use-inbox-marks";

/**
 * Polite live line above the list (design 07 `inl-st`): a write failure, or the read-all result with «Deshacer».
 * The live container stays mounted so screen readers announce what appears in it.
 */
export function InboxMarkStatus({ status, busy, onUndo }: { status: MarkStatus; busy: boolean; onUndo: () => void }) {
  return <div aria-live="polite" aria-atomic="true" className="shrink-0 px-2 empty:hidden">
    {status?.kind === "message" && <p className="mx-2.5 mt-2 rounded-[14px] bg-muted px-3 py-2 text-[13px]">{status.text}</p>}
    {status?.kind === "undo" && <div className="mx-2.5 mt-2 flex items-center gap-2 rounded-[14px] bg-muted py-1.5 pr-1.5 pl-3 text-[13px]">
      <CheckCheck aria-hidden="true" className="size-4 text-status-success" />
      <span>{markedAllStatus(status.affected)}</span>
      <Button type="button" variant="ghost" className="ml-auto min-h-8" disabled={busy} onClick={onUndo}>Deshacer</Button>
    </div>}
  </div>;
}

/** One line under the tabs while filters are active: «Postulaciones · Analista de Nómina» with «Limpiar». */
export function InboxFilterSummary({ summary, onClear }: { summary: string; onClear: () => void }) {
  return <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border/45 py-0.5 pr-3 pl-6 text-[13px] max-sm:pl-4">
    <p role="status" className="min-w-0 flex-1 truncate font-medium text-foreground">{summary}</p>
    <Button type="button" variant="ghost" className="min-h-9 px-2.5" onClick={onClear}><X aria-hidden="true" data-icon="inline-start" />Limpiar</Button>
  </div>;
}

/** Sheet footer (design 07 `ns-f`); «Preferencias» joins it in stage 2. */
export function InboxFooter({ unread, busy, onMarkAll }: { unread: number; busy: boolean; onMarkAll: () => void }) {
  if (unread < 1) return null;
  return <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-4 pt-2 pb-3">
    <Button type="button" variant="outline" className="min-h-10" disabled={busy} aria-busy={busy || undefined} onClick={onMarkAll}>
      <CheckCheck aria-hidden="true" data-icon="inline-start" />Marcar todo como leído
    </Button>
  </div>;
}
