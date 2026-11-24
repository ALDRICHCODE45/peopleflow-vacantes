"use client";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Board, Participation } from "./model";
import { isInProcess, NO_SUBSTATE, substateOptions } from "./substates";

export function SubstateSelect({ board, item, onChange, disabled, describedBy, configHref }: { board: Board; item: Participation; onChange: (id: string, value: string | null) => void; disabled?: boolean; describedBy?: string; configHref?: string }) {
  if (!isInProcess(board, item)) return null;
  const options = substateOptions(board);
  const id = `candidate-substate-${item.id}`;
  return <FieldGroup className="min-w-0 sm:w-52"><Field>
    <FieldLabel htmlFor={id}>Subestado</FieldLabel>
    <Select items={options} value={item.substate_id ?? NO_SUBSTATE} disabled={disabled} onValueChange={value => { if (value !== null) onChange(item.id, value === NO_SUBSTATE ? null : value); }}>
      <SelectTrigger id={id} aria-label="Subestado" aria-describedby={describedBy} className="min-h-10 w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value} className="min-h-10">{option.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
    {!board.substates.length && configHref && <Link href={configHref} className="inline-flex min-h-10 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"><Settings2 aria-hidden="true" className="size-4" />Configurar subestados…</Link>}
  </Field></FieldGroup>;
}
