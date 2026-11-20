"use client";
import { BadgeCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useCompactViewport } from "@/features/vacancy-lifecycle/ui/use-compact-viewport";
import type { Board, Participation } from "./model";

const coverageCopy = ({ covered, required }: { covered: number; required: number | null }) => required === null ? String(covered) : `${covered} de ${required}`;

/**
 * S3 · artboard 04 step 2: the small confirmation pinned to the card (a bottom sheet on a phone). One option (the only departure that rides this route),
 * the coverage before → after, and that the original result stays. It is a sibling of the «⋯» menu: the invisible trigger
 * below is only the anchor (the parent wrapper is `relative`), the dialog is always controlled by the board.
 */
export function DepartureConfirm({ item, board, pending, onConfirm, onCancel }: { item: Participation; board: Board; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const compact = useCompactViewport();
  const first = item.candidate.full_name.split(/\s+/u)[0];
  const title = `¿Marcar a ${first} como «No se sostuvo»?`;
  const { covered, required } = board.coverage;
  const description = `Sale de la cobertura.${board.lifecycle.process === "finished" ? " El tablero sigue en solo lectura y el" : " El"} cambio queda en el historial.`;
  const finalFocus = () => document.getElementById(`candidate-move-${item.id}`);
  const option = <div role="group" aria-label="Qué pasó con este placement" className="flex items-start gap-2.5 rounded-lg border border-primary bg-primary/10 px-3 py-2">
    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
    <div className="flex flex-col gap-0.5"><span className="text-sm font-medium">El candidato se fue</span><span className="text-xs text-muted-foreground">Renunció, no se presentó o se cayó después.</span></div>
  </div>;
  const facts = <dl className="flex flex-col gap-1.5 text-xs">
    <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Plazas cubiertas</dt><dd className="font-medium tabular-nums">{coverageCopy({ covered, required })} → {coverageCopy({ covered: Math.max(0, covered - 1), required })}</dd></div>
    <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Resultado original</dt><dd className="font-medium">Sin cambios</dd></div>
  </dl>;
  const cancel = <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={onCancel}>Cancelar</Button>;
  const confirm = <Button type="button" className="min-h-10" disabled={pending} aria-busy={pending || undefined} onClick={onConfirm}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending ? "Marcando…" : "Marcar «No se sostuvo»"}</Button>;
  // The sheet and its backdrop are portalled but still bubble through React to the card, whose click opens the candidate: stop them here.
  if (compact) return <div className="contents" onClick={event => event.stopPropagation()}><Drawer open onOpenChange={open => { if (!open && !pending) onCancel(); }}>
    <DrawerContent finalFocus={finalFocus}>
      <DrawerHeader className="gap-1 pb-3 text-left">
        <DrawerTitle className="flex items-start gap-2 text-base"><BadgeCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />{title}</DrawerTitle>
        <DrawerDescription className="text-left">{description}</DrawerDescription>
      </DrawerHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">{option}{facts}</div>
      <DrawerFooter className="flex-row justify-end gap-2">{cancel}{confirm}</DrawerFooter>
    </DrawerContent>
  </Drawer></div>;
  return <Popover open onOpenChange={open => { if (!open && !pending) onCancel(); }}>
    <PopoverTrigger nativeButton={false} render={<span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-0" />} />
    {/* 372 px like the artboard: the two actions share one row. */}
    <PopoverContent side="bottom" align="end" aria-label={title} className="w-[23.25rem] max-w-[calc(100vw-2rem)] gap-3 rounded-xl p-4" onClick={event => event.stopPropagation()} finalFocus={finalFocus}>
      <PopoverHeader>
        <PopoverTitle className="flex items-center gap-2 text-sm font-semibold"><BadgeCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />{title}</PopoverTitle>
        <PopoverDescription>{description}</PopoverDescription>
      </PopoverHeader>
      {option}
      {facts}
      <div className="flex justify-end gap-2">{cancel}{confirm}</div>
    </PopoverContent>
  </Popover>;
}
