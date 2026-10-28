"use client";
import { Ellipsis, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FieldError } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { updateCriterionIdentity, type Criterion } from "../model";
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
export function CriteriaRows({ criteria, onChange, onEdit, disabled, errors }: { criteria: Criterion[]; onChange: (criteria: Criterion[]) => void; onEdit: (criterion: Criterion) => void; disabled: boolean; errors: Record<number, string> }) {
  return <ItemGroup role="list" aria-label="Criterios del checklist">{criteria.map((criterion, index) => <Item key={criterion.id} role="listitem" variant="outline" size="sm" aria-label={`Criterio ${index + 1}: ${criterion.label}`}>
    <ItemContent>
      <ItemTitle><span aria-hidden="true">{index + 1}.</span><span>{criterion.label}</span></ItemTitle>
      <ItemDescription>{KIND_LABELS[criterion.kind]} · {criterion.kind === "manual" ? "Lo marcas tú" : criterion.kind === "skill" ? "Se evalúa solo si el candidato la declara" : "Se evalúa solo"}</ItemDescription>
      <ToggleGroup variant="segmented" aria-label={`Importancia: ${criterion.label}`} disabled={disabled} value={[criterion.importance]} onValueChange={values => { const importance = values[0]; if (importance === "required" || importance === "desirable") onChange(criteria.map((item, position) => position === index ? updateCriterionIdentity(item, { ...item, importance }) : item)); }}><ToggleGroupItem value="required">Obligatorio</ToggleGroupItem><ToggleGroupItem value="desirable">Deseable</ToggleGroupItem></ToggleGroup>
      {errors[index] && <FieldError id={`criterion-error-${criterion.id}`}>{errors[index]}</FieldError>}
    </ItemContent>
    <ItemActions>
      <Button type="button" variant="ghost" size="icon" className="size-10" disabled={disabled} aria-label={`Editar ${criterion.label}`} aria-invalid={!!errors[index]} aria-describedby={errors[index] ? `criterion-error-${criterion.id}` : undefined} onClick={() => onEdit(criterion)}><Pencil aria-hidden="true" /></Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" disabled={disabled} aria-label={`Acciones de ${criterion.label}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{criterionActions(index, criteria.length).filter(action => action.key !== "remove").map(action => <DropdownMenuItem key={action.key} className="min-h-10" disabled={disabled || action.disabled} onClick={() => onChange(applyCriterionAction(criteria, index, action.key))}>{action.label}</DropdownMenuItem>)}</DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem variant="destructive" className="min-h-10" disabled={disabled} onClick={() => onChange(applyCriterionAction(criteria, index, "remove"))}>Quitar criterio</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    </ItemActions>
  </Item>)}</ItemGroup>;
}
