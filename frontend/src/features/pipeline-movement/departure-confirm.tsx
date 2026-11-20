"use client";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { Board, Participation } from "./model";

const coverageCopy = ({ covered, required }: { covered: number; required: number | null }) => required === null ? String(covered) : `${covered} de ${required}`;

/**
 * S3 · artboard 04 step 2: the small confirmation pinned to the card. One option (the only departure that rides this route),
 * the coverage before → after, and that the original result stays. It is a sibling of the «⋯» menu: the invisible trigger
 * below is only the anchor (the parent wrapper is `relative`), the dialog is always controlled by the board.
 */
export function DepartureConfirm({ item, board, pending, onConfirm, onCancel }: { item: Participation; board: Board; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const first = item.candidate.full_name.split(/\s+/u)[0];
  const title = `¿Marcar a ${first} como «No se sostuvo»?`;
  const { covered, required } = board.coverage;
  return <Popover open onOpenChange={open => { if (!open && !pending) onCancel(); }}>
    <PopoverTrigger nativeButton={false} render={<span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-0" />} />
    <PopoverContent side="bottom" align="end" aria-label={title} className="w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-xl p-4" onClick={event => event.stopPropagation()}
      finalFocus={() => document.getElementById(`candidate-move-${item.id}`)}>
      <PopoverHeader>
        <PopoverTitle className="flex items-center gap-2 text-sm font-semibold"><BadgeCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />{title}</PopoverTitle>
        <PopoverDescription>Sale de la cobertura.{board.lifecycle.process === "finished" ? " El tablero sigue en solo lectura y el" : " El"} cambio queda en el historial.</PopoverDescription>
      </PopoverHeader>
      <div role="group" aria-label="Qué pasó con este placement" className="flex flex-col gap-0.5 rounded-lg border border-primary bg-primary/10 px-3 py-2">
        <span className="text-sm font-medium">El candidato se fue</span>
        <span className="text-xs text-muted-foreground">Renunció, no se presentó o se cayó después.</span>
      </div>
      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Plazas cubiertas</dt><dd className="font-medium tabular-nums">{coverageCopy({ covered, required })} → {coverageCopy({ covered: Math.max(0, covered - 1), required })}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Resultado original</dt><dd className="font-medium">Sin cambios</dd></div>
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={onCancel}>Cancelar</Button>
        <Button type="button" className="min-h-10" disabled={pending} aria-busy={pending || undefined} onClick={onConfirm}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending ? "Marcando…" : "Marcar «No se sostuvo»"}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
