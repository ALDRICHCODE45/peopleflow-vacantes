"use client";

import { useMemo } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CompanyMembers } from "./model";

/** Pickers list people alphabetically (es-MX collation) without mutating the caller's list. */
export function sortPeople<T extends { user: { full_name: string } }>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => a.user.full_name.localeCompare(b.user.full_name, "es-MX"));
}

export function PersonField({ id, label, members, value, onChange, error }: { id: string; label: string; members: CompanyMembers["members"]; value: string; onChange: (id: string) => void; error?: string }) {
  const ordered = useMemo(() => sortPeople(members), [members]);
  return <Field data-invalid={!!error}><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Combobox items={ordered} value={members.find(member => member.user.id === value) ?? null} onValueChange={member => onChange(member?.user.id ?? "")} itemToStringLabel={member => member.user.full_name} itemToStringValue={member => member.user.id}>
      <ComboboxInput id={id} className="min-h-10" placeholder="Busca a una persona" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
      <ComboboxContent><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>{(member: CompanyMembers["members"][number]) => <ComboboxItem key={member.id} value={member} className="min-h-10">{member.user.full_name}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}
export function ChoiceField({ id, label, items, value, onChange, error }: { id: string; label: string; items: readonly { value: string; label: string }[]; value: string; onChange: (value: string) => void; error?: string }) {
  return <Field data-invalid={!!error}><FieldLabel htmlFor={id}>{label}</FieldLabel><Select items={items} value={value || null} onValueChange={value => { if (value) onChange(value); }}><SelectTrigger id={id} className="min-h-10 w-full" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}><SelectValue placeholder="Elige una opción" /></SelectTrigger><SelectContent><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value} className="min-h-10">{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</Field>;
}
