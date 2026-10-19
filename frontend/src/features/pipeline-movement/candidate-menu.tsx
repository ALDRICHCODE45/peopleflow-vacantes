"use client";
import { ArrowRight, Ellipsis, RotateCcw, UserRound, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { Board, Participation } from "./model";
import { NO_SUBSTATE, substateOptions } from "./substates";
import { stageClass } from "./pipeline-presentation";

type Props = {
  item: Participation; targets: Board["stages"]; disabled?: boolean; pending?: boolean; full?: boolean; describedBy?: string;
  substates?: Board["substates"]; onSubstate?: (id: string, substateId: string | null) => void;
  onMove: (id: string, stage: string) => void; onDetail: (id: string) => void;
  onDisposition: (id: string, kind: "discard" | "recover") => void;
};
export function CandidateMenu({ item, targets, disabled, pending, full, describedBy, onMove, onDetail, onDisposition, substates = [], onSubstate }: Props) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant={full ? "default" : "ghost"} size={full ? "default" : "icon"} className={full ? "h-10" : "size-10"} disabled={disabled} id={full ? `candidate-sheet-move-${item.id}` : `candidate-move-${item.id}`} aria-label={full ? "Mover a…" : `Acciones de ${item.candidate.full_name}`} aria-describedby={describedBy} />}>
      {pending ? <Spinner aria-label="Guardando cambio…" /> : full ? <><ArrowRight aria-hidden="true" data-icon="inline-start" />Mover a…</> : <Ellipsis aria-hidden="true" />}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56" onClick={event => event.stopPropagation()}>
      <DropdownMenuGroup>{item.discard ? <DropdownMenuItem className="min-h-10" disabled={disabled} onClick={() => onDisposition(item.id, "recover")}><RotateCcw aria-hidden="true" />Recuperar</DropdownMenuItem> : <>
        <DropdownMenuLabel>Mover a…</DropdownMenuLabel>
        {targets.map(stage => <DropdownMenuItem key={stage.id} className="min-h-10" disabled={disabled} onClick={() => onMove(item.id, stage.id)}><span aria-hidden="true" className={`${stageClass(stage.kind)} stage-dot size-2 shrink-0 rounded-full`} />{stage.name}<ArrowRight aria-hidden="true" className="ml-auto" /></DropdownMenuItem>)}
      </>}</DropdownMenuGroup>
      {!full && onSubstate && <><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuSub>
        <DropdownMenuSubTrigger className="min-h-10" disabled={disabled}>Subestado</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64"><DropdownMenuRadioGroup aria-label="Subestado" value={item.substate_id ?? NO_SUBSTATE} onValueChange={value => onSubstate(item.id, value === NO_SUBSTATE ? null : String(value))}>
          {substateOptions({ substates }).map(option => <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-10" disabled={disabled}>{option.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></DropdownMenuSubContent>
      </DropdownMenuSub></DropdownMenuGroup></>}
      {!full && <><DropdownMenuSeparator /><DropdownMenuGroup>
        <DropdownMenuItem className="min-h-10" onClick={() => onDetail(item.id)}><UserRound aria-hidden="true" />Ver ficha</DropdownMenuItem>
        {!item.discard && <DropdownMenuItem className="min-h-10" variant="destructive" disabled={disabled} onClick={() => onDisposition(item.id, "discard")}><UserRoundX aria-hidden="true" />Descartar</DropdownMenuItem>}
      </DropdownMenuGroup></>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
