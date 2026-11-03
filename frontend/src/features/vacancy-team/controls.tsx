"use client";

import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { plural } from "@/features/employer-vacancies/plural";
import type { CompanyMembers, Snapshot } from "./model";
import { formatDate, sourceLabel } from "./model";

export function PersonField({ id, label, members, value, onChange, error }: { id: string; label: string; members: CompanyMembers["members"]; value: string; onChange: (id: string) => void; error?: string }) {
  return <Field data-invalid={!!error}><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Combobox items={members} value={members.find(member => member.user.id === value) ?? null} onValueChange={member => onChange(member?.user.id ?? "")} itemToStringLabel={member => member.user.full_name} itemToStringValue={member => member.user.id}>
      <ComboboxInput id={id} className="min-h-10" placeholder="Busca a una persona" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
      <ComboboxContent><ComboboxEmpty>Sin coincidencias.</ComboboxEmpty><ComboboxList>{(member: CompanyMembers["members"][number]) => <ComboboxItem key={member.id} value={member} className="min-h-10">{member.user.full_name}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}
export function ChoiceField({ id, label, items, value, onChange, error }: { id: string; label: string; items: readonly { value: string; label: string }[]; value: string; onChange: (value: string) => void; error?: string }) {
  return <Field data-invalid={!!error}><FieldLabel htmlFor={id}>{label}</FieldLabel><Select items={items} value={value || null} onValueChange={value => { if (value) onChange(value); }}><SelectTrigger id={id} className="min-h-10 w-full" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}><SelectValue placeholder="Elige una opción" /></SelectTrigger><SelectContent><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value} className="min-h-10">{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</Field>;
}
export function SnapshotDetails({ snapshot }: { snapshot: Snapshot }) {
  const publication = { draft: "Borrador", published: "Publicada", paused: "Pausada", closed: "Cerrada" };
  return <section aria-label="Estado guardado al reasignar" className="flex min-w-0 flex-col gap-2 text-sm">
    <h4 className="font-semibold">Estado guardado al reasignar</h4>
    <p className="text-muted-foreground">{publication[snapshot.lifecycle.publication]} · {snapshot.lifecycle.process === "finished" ? "Proceso terminado" : snapshot.lifecycle.process === "active" ? "Proceso activo" : "Sin proceso"} · {formatDate(snapshot.captured_at)}</p>
    <ul className="flex flex-col gap-1">{snapshot.stage_counts.map(stage => <li key={stage.stage_id}>{stage.stage_name}: {plural(stage.active, "activo", "activos")} · {plural(stage.discarded, "descartado", "descartados")}</li>)}</ul>
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Inicio del tramo</dt><dd>{formatDate(snapshot.tramo.started_at)}</dd></div>
      <div><dt className="text-muted-foreground">Plazo efectivo</dt><dd>{formatDate(snapshot.tramo.effective_deadline)} · {sourceLabel[snapshot.tramo.deadline_source]}</dd></div>
      <div><dt className="text-muted-foreground">Días hábiles consumidos</dt><dd>{snapshot.tramo.business_days_elapsed ?? "Sin dato"} de {snapshot.tramo.business_days_total ?? "Sin dato"}</dd></div>
      <div><dt className="text-muted-foreground">Entrega</dt><dd>{snapshot.delivery.delivered} de {snapshot.delivery.target ?? "Sin objetivo"} · {snapshot.delivery.fulfilled_at ? `Cumplida ${formatDate(snapshot.delivery.fulfilled_at)}` : "Sin cumplir"}</dd></div>
      <div><dt className="text-muted-foreground">Fecha compromiso</dt><dd>{formatDate(snapshot.delivery.commitment_date)}</dd></div>
      <div><dt className="text-muted-foreground">Placements</dt><dd>{plural(snapshot.placements.current, "actual", "actuales")} · {plural(snapshot.placements.credited, "acreditado", "acreditados")}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">Solo conteos y fechas; sin datos de candidatos.</p>
  </section>;
}
