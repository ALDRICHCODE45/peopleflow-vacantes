"use client";
import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, Search, SlidersHorizontal } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor } from "@/components/ui/combobox";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { WORK_MODE_OPTIONS } from "@/features/jobs/drafts/ui/draft-labels";
import { publicJobConditions } from "@/features/jobs/components/public-job-facts";
import { formatPublishedDate } from "@/features/jobs/formatters";
import type { PublicJobItem } from "@/features/jobs/types";

export type CompanyJobFilters = { search: string; modes: string[]; states: string[] };
const emptyFilters = (): CompanyJobFilters => ({ search: "", modes: [], states: [] });
const normalized = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
export function filterCompanyJobs(jobs: PublicJobItem[], filters: CompanyJobFilters) {
  return jobs.filter(job => normalized(job.title).includes(normalized(filters.search.trim()))
    && (!filters.modes.length || filters.modes.includes(job.work_mode))
    && (!filters.states.length || (job.location?.state && filters.states.includes(job.location.state.id))));
}
type Option = { value: string; label: string };
/** Official multiple combobox composition; labels come from the loaded public projection. */
function Dimension({ label, options, values, onChange }: { label: string; options: Option[]; values: string[]; onChange: (values: string[]) => void }) {
  const id = useId();
  const anchor = useComboboxAnchor();
  const selected = useMemo(() => options.filter(option => values.includes(option.value)), [options, values]);
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Combobox multiple items={options} value={selected} onValueChange={items => onChange(items.map(item => item.value))} itemToStringLabel={item => item.label} itemToStringValue={item => item.value} isItemEqualToValue={(item, value) => item.value === value.value}>
    <ComboboxChips ref={anchor} className="min-h-10"><ComboboxValue>{selected.map(item => <ComboboxChip key={item.value} aria-label={`Quitar filtro ${label}: ${item.label}`}>{item.label}</ComboboxChip>)}</ComboboxValue><ComboboxChipsInput id={id} aria-label={label} placeholder="Todas las opciones" /></ComboboxChips>
    <ComboboxContent anchor={anchor}><ComboboxEmpty>No se encontraron opciones.</ComboboxEmpty><ComboboxList>{(item: Option) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox></Field>;
}
export function CompanyJobs({ jobs }: { jobs: PublicJobItem[] }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [open, setOpen] = useState(false);
  const id = useId();
  const shown = filterCompanyJobs(jobs, filters);
  const states = useMemo(() => [...new Map(jobs.flatMap(job => job.location?.state ? [[job.location.state.id, { value: job.location.state.id, label: job.location.state.name }] as const] : [])).values()], [jobs]);
  const clear = () => setFilters(emptyFilters());
  const count = filters.modes.length + filters.states.length;
  if (!jobs.length) return <StateCard icon={Briefcase} tone="empty" title="Por ahora no hay vacantes abiertas. Vuelve pronto." description="Las nuevas oportunidades aparecerán aquí cuando se publiquen." />;
  return <div className="flex flex-col gap-4">
    <Field><FieldLabel htmlFor={id}>Buscar por título</FieldLabel><InputGroup className="min-h-10"><InputGroupInput id={id} value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon></InputGroup></Field>
    {/* Sheet-demo: the root owns only its trigger/panel, never the results. */}
    <Sheet open={open} onOpenChange={setOpen}><SheetTrigger render={<Button variant="outline" className="min-h-10 self-start" />}><SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Filtros{count ? ` (${count})` : ""}</SheetTrigger>
      <SheetContent showCloseButton={false}>
        <SheetHeader className="border-b"><SlidersHorizontal aria-hidden="true" className="size-5" /><SheetTitle>Filtrar vacantes</SheetTitle><SheetDescription>Encuentra una oportunidad para ti.</SheetDescription></SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-6"><FieldGroup>
          <Dimension label="Modalidad" options={WORK_MODE_OPTIONS} values={filters.modes} onChange={modes => setFilters({ ...filters, modes })} />
          <Dimension label="Estado" options={states} values={filters.states} onChange={states => setFilters({ ...filters, states })} />
          <p className="text-sm text-muted-foreground">Las opciones de un mismo filtro se suman. Entre filtros, las vacantes deben cumplir todas las condiciones.</p>
        </FieldGroup></div>
        <SheetFooter className="border-t"><p role="status">{shown.length === 1 ? "1 vacante coincide" : `${shown.length} vacantes coinciden`}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" className="min-h-10" onClick={clear}>Quitar filtros</Button><SheetClose render={<Button className="min-h-10" />}>Ver resultados</SheetClose></div></SheetFooter>
      </SheetContent>
    </Sheet>
    {shown.length ? <ul aria-label="Vacantes de la empresa" className="grid gap-4">{shown.map(job => <li key={job.id}><Card><CardHeader><CardTitle><h3><Link className="inline-flex min-h-10 items-center underline" href={`/vacantes/${job.id}`}>{job.title}</Link></h3></CardTitle></CardHeader><CardContent><dl className="flex flex-wrap gap-4">{publicJobConditions(job).map(({ key, label, value, Icon }) => <div key={key}><dt className="flex items-center gap-2 text-sm text-muted-foreground"><Icon aria-hidden="true" className="size-4" />{label}</dt><dd>{value}</dd></div>)}</dl></CardContent><CardFooter><time dateTime={job.published_at}>{formatPublishedDate(job.published_at)}</time></CardFooter></Card></li>)}</ul> : <StateCard icon={Search} tone="empty" title="No encontramos vacantes con estos filtros." description="Prueba otra búsqueda o consulta todas las oportunidades." primaryAction={{ label: "Quitar filtros", onClick: clear }} />}
  </div>;
}
