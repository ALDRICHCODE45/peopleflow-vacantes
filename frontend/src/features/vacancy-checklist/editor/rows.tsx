"use client";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Criterion } from "../model";
import { KIND_LABELS } from "./criterion-dialog";
export type CriterionAction = "up" | "down" | "remove";
export function criterionActions(index: number, length: number): { key: CriterionAction; label: string; disabled: boolean }[] {
  return [{ key: "up", label: "Subir", disabled: index === 0 }, { key: "down", label: "Bajar", disabled: index === length - 1 }, { key: "remove", label: "Quitar criterio", disabled: false }];
}
export function applyCriterionAction(criteria: Criterion[], index: number, action: CriterionAction): Criterion[] {
  if (index < 0 || index >= criteria.length) return criteria;
  if (action === "remove") return criteria.filter((_, position) => position !== index);
  const nextIndex = index + (action === "up" ? -1 : 1);
  if (nextIndex < 0 || nextIndex >= criteria.length) return criteria;
  const next = [...criteria]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]]; return next;
}
export function CriterionMenu({ criterion, index, length, disabled, onAction }: { criterion: Criterion; index: number; length: number; disabled: boolean; onAction: (action: CriterionAction) => void }) {
  return <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" disabled={disabled} aria-label={`Acciones de ${criterion.label || "Nuevo criterio"}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{criterionActions(index, length).filter(action => action.key !== "remove").map(action => <DropdownMenuItem key={action.key} className="min-h-10" disabled={disabled || action.disabled} onClick={() => onAction(action.key)}>{action.label}</DropdownMenuItem>)}</DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem variant="destructive" className="min-h-10" disabled={disabled} onClick={() => onAction("remove")}>Quitar criterio</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>;
}
export function CriteriaRows({ criteria, selected, onSelect, errors }: { criteria: Criterion[]; selected: number; onSelect: (index: number) => void; errors: Record<number, string> }) {
  return <ul aria-label="Criterios del checklist" className="flex min-w-0 flex-col gap-2">{criteria.map((criterion, index) => <li key={criterion.id}>
    <Item size="sm" render={<button type="button" />} aria-label={`Seleccionar ${criterion.label || "Nuevo criterio"}`} aria-pressed={selected === index} aria-controls="checklist-detail" aria-describedby={errors[index] ? `criterion-error-${criterion.id}` : undefined} onClick={() => onSelect(index)} className={cn("min-h-16 w-full flex-nowrap gap-3 rounded-2xl px-3 py-3 text-left outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-transparent focus-visible:ring-3 focus-visible:ring-ring/30", selected === index ? "bg-card text-foreground shadow-sm ring-1 ring-primary/40" : "text-muted-foreground")}>
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold">{index + 1}</span>
      <ItemContent className="min-w-0"><ItemTitle className="max-w-full"><span className="line-clamp-2 break-words">{criterion.label || "Nuevo criterio"}</span></ItemTitle><ItemDescription>{KIND_LABELS[criterion.kind]}</ItemDescription></ItemContent>
      <Badge variant={criterion.importance === "required" ? "accent" : "neutral"}>{criterion.importance === "required" ? "Obligatorio" : "Deseable"}</Badge>
    </Item>
    {errors[index] && <FieldError id={`criterion-error-${criterion.id}`}>{errors[index]}</FieldError>}
  </li>)}</ul>;
}
