"use client";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgeX, Ellipsis, Link2, Replace, RotateCcw, UserRound, UserRoundX } from "lucide-react";
import { vacancyPipelineHref } from "@/features/employer-vacancies/model";
import type { StartOffer } from "@/features/vacancy-lifecycle/replacement-state";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { Board, Participation } from "./model";
import { NO_SUBSTATE, substateOptions } from "./substates";
import { stageClass } from "./pipeline-presentation";

type Props = {
  item: Participation; targets: Board["stages"]; isBackward?: (stageId: string) => boolean; disabled?: boolean; pending?: boolean; full?: boolean; describedBy?: string;
  substates?: Board["substates"]; onSubstate?: (id: string, substateId: string | null) => void;
  onMove: (id: string, stage: string) => void; onDetail: (id: string) => void;
  onDisposition: (id: string, kind: "discard" | "recover") => void;
  /** Replacement entry points (S1/S3/S6). On a finished board these are the ONLY items: everything else stays read-only. */
  finished?: boolean; leave?: () => void; start?: { offer: Exclude<StartOffer, { kind: "none" }>; onStart: () => void };
};
function ReplacementItems({ leave, start, disabled }: Pick<Props, "leave" | "start" | "disabled">) {
  return <>
    {leave && <DropdownMenuItem className="min-h-10" disabled={disabled} onClick={leave}><BadgeX aria-hidden="true" />No se sostuvo…</DropdownMenuItem>}
    {start?.offer.kind === "ready" && <DropdownMenuItem className="min-h-10" disabled={disabled} onClick={start.onStart}><Replace aria-hidden="true" />Iniciar reemplazo</DropdownMenuItem>}
    {start?.offer.kind === "blocked" && <>
      <DropdownMenuItem className="h-auto min-h-10 items-start py-2" disabled><Replace aria-hidden="true" /><span className="flex min-w-0 flex-col gap-0.5">Iniciar reemplazo<span className="text-xs font-normal whitespace-normal text-muted-foreground">{start.offer.reason}</span></span></DropdownMenuItem>
      {start.offer.activeReplacementId && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-10 text-primary" render={<Link href={vacancyPipelineHref(start.offer.activeReplacementId)} />}><Link2 aria-hidden="true" />Ver reemplazo activo</DropdownMenuItem></>}
    </>}
  </>;
}
export function CandidateMenu({ item, targets, isBackward, disabled, pending, full, describedBy, onMove, onDetail, onDisposition, substates = [], onSubstate, finished, leave, start }: Props) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant={full ? "default" : "ghost"} size={full ? "default" : "icon"} className={full ? "h-10" : "size-10"} disabled={disabled} id={full ? `candidate-sheet-move-${item.id}` : `candidate-move-${item.id}`} aria-label={full ? "Mover a…" : `Acciones de ${item.candidate.full_name}`} aria-describedby={describedBy} />}>
      {pending ? <Spinner aria-label="Guardando cambio…" /> : full ? <><ArrowRight aria-hidden="true" data-icon="inline-start" />Mover a…</> : <Ellipsis aria-hidden="true" />}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56" onClick={event => event.stopPropagation()}>
      {/* On a phone the menu names whose card it belongs to (artboard 04); the desktop menu hangs from the card itself. */}
      {!full && <DropdownMenuGroup><DropdownMenuLabel className="truncate text-sm font-medium text-foreground sm:hidden">{item.candidate.full_name}</DropdownMenuLabel></DropdownMenuGroup>}
      {finished ? <DropdownMenuGroup><ReplacementItems leave={leave} start={start} disabled={disabled} /></DropdownMenuGroup> : <>
      <DropdownMenuGroup>{item.discard ? <DropdownMenuItem className="min-h-10" disabled={disabled} onClick={() => onDisposition(item.id, "recover")}><RotateCcw aria-hidden="true" />Recuperar</DropdownMenuItem> : <>
        <DropdownMenuLabel>Mover a…</DropdownMenuLabel>
        {targets.map(stage => <DropdownMenuItem key={stage.id} className="min-h-10" disabled={disabled} onClick={() => onMove(item.id, stage.id)}><span aria-hidden="true" className={`${stageClass(stage.kind)} stage-dot size-2 shrink-0 rounded-full`} />{stage.name}{isBackward?.(stage.id) ? <ArrowLeft aria-hidden="true" data-direction="back" className="ml-auto" /> : <ArrowRight aria-hidden="true" data-direction="forward" className="ml-auto" />}</DropdownMenuItem>)}
      </>}</DropdownMenuGroup>
      {!full && leave && <><DropdownMenuSeparator /><DropdownMenuGroup><ReplacementItems leave={leave} disabled={disabled} /></DropdownMenuGroup></>}
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
      {!full && start && <><DropdownMenuSeparator /><DropdownMenuGroup><ReplacementItems start={start} disabled={disabled} /></DropdownMenuGroup></>}
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
