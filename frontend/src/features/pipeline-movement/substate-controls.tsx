"use client";
import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Board, Participation } from "./model";
import { isInProcess, NO_SUBSTATE, substateOptions, toggleSubstateFilter } from "./substates";

export function BoardSubstateFilter({ board, value, onChange }: { board: Board; value: string[]; onChange: (value: string[]) => void }) {
  return <div className="flex flex-wrap items-center gap-2">
    <DropdownMenu><DropdownMenuTrigger render={<Button id="board-substate-filter" type="button" variant="outline" className="min-h-10" />}>
      <ListFilter aria-hidden="true" data-icon="inline-start" />Subestados{value.length > 0 && ` (${value.length})`}
    </DropdownMenuTrigger><DropdownMenuContent align="start" className="w-64"><DropdownMenuGroup>
      <DropdownMenuLabel>Filtrar por subestado</DropdownMenuLabel>
      {substateOptions(board).map(option => <DropdownMenuCheckboxItem key={option.value} className="min-h-10" checked={value.includes(option.value)} closeOnClick={false}
        onCheckedChange={checked => onChange(toggleSubstateFilter(value, option.value, checked))}>{option.label}</DropdownMenuCheckboxItem>)}
    </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    {value.length > 0 && <Button type="button" variant="ghost" className="min-h-10" onClick={() => onChange([])}>Limpiar</Button>}
  </div>;
}
export function SubstateSelect({ board, item, onChange, disabled, describedBy }: { board: Board; item: Participation; onChange: (id: string, value: string | null) => void; disabled?: boolean; describedBy?: string }) {
  if (!isInProcess(board, item)) return null;
  const options = substateOptions(board);
  const id = `candidate-substate-${item.id}`;
  return <FieldGroup className="min-w-0 sm:w-52"><Field>
    <FieldLabel htmlFor={id}>Subestado</FieldLabel>
    <Select items={options} value={item.substate_id ?? NO_SUBSTATE} disabled={disabled} onValueChange={value => { if (value !== null) onChange(item.id, value === NO_SUBSTATE ? null : value); }}>
      <SelectTrigger id={id} aria-label="Subestado" aria-describedby={describedBy} className="min-h-10 w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value} className="min-h-10">{option.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </Field></FieldGroup>;
}
