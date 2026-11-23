"use client";

import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import type { DocumentOverview } from "../model";

export type Participation = DocumentOverview["participations"][number];

/** Searchable list of the vacancy's participations (stage, «Descartado»), also the discarded ones: they take documents too (S3). */
export function CandidatePicker({ id, label, participations, value, onChange, disabled = false, placeholder, isItemDisabled, className }: {
  id: string; label: string; participations: Participation[]; value: string | null; onChange: (participationId: string | null) => void;
  disabled?: boolean; placeholder: string; isItemDisabled?: (participation: Participation) => boolean; className?: string;
}) {
  const selected = participations.find(entry => entry.participation_id === value) ?? null;
  return <Combobox items={participations} value={selected} disabled={disabled} onValueChange={next => onChange(next?.participation_id ?? null)}
    itemToStringLabel={entry => entry.candidate.full_name} itemToStringValue={entry => entry.participation_id}>
    <ComboboxInput id={id} aria-label={label} className={className ?? "min-h-10 w-full sm:w-64"} placeholder={placeholder} disabled={disabled} showClear={selected !== null && !disabled} clearLabel="Quitar candidato" triggerLabel="Mostrar candidatos" />
    <ComboboxContent>
      <ComboboxEmpty>Sin coincidencias.</ComboboxEmpty>
      <ComboboxList>{(entry: Participation) => <ComboboxItem key={entry.participation_id} value={entry} disabled={isItemDisabled?.(entry)} className="min-h-10">
        <span className="flex min-w-0 flex-col"><span className="truncate font-medium">{entry.candidate.full_name}</span><span className="truncate text-xs text-muted-foreground">{entry.stage.name}</span></span>
        {entry.discarded && <Badge variant="neutral">Descartado</Badge>}
      </ComboboxItem>}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}
