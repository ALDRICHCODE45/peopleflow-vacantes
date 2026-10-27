"use client";
import { Fragment, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Briefcase, Search, SlidersHorizontal } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StateCard } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor } from "@/components/ui/combobox";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PROFESSIONAL_AREA_OPTIONS, WORK_MODE_OPTIONS } from "@/features/jobs/drafts/ui/draft-labels";
import { publicJobConditions } from "@/features/jobs/components/public-job-facts";
import type { PublicJobItem } from "@/features/jobs/types";

export type CompanyJobFilters = { search: string; modes: string[]; states: string[] };
const emptyFilters = (): CompanyJobFilters => ({ search: "", modes: [], states: [] });
const normalized = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
export function filterCompanyJobs(jobs: PublicJobItem[], filters: CompanyJobFilters) {
  return jobs.filter(job => normalized(job.title).includes(normalized(filters.search.trim()))
    && (!filters.modes.length || filters.modes.includes(job.work_mode))
    && (!filters.states.length || (job.location?.state && filters.states.includes(job.location.state.id))));
}
const areaLabel = (area: PublicJobItem["professional_area"]) => PROFESSIONAL_AREA_OPTIONS.find(option => option.value === area)?.label ?? "Otras oportunidades";
function JobMeta({ job }: { job: PublicJobItem }) {
  return <span data-job-meta className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">{publicJobConditions(job).map(({ key, label, value, Icon }) => <span key={key} className="inline-flex min-w-0 items-center gap-1.5"><Icon aria-hidden="true" className="size-3.5 shrink-0" /><span className="sr-only">{label}: </span><span>{value}</span></span>)}</span>;
}
const publishedDate = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });
function JobDate({ date }: { date: string }) {
  return <time className="text-xs text-muted-foreground" dateTime={date}>Publicada el {publishedDate.format(new Date(date))}</time>;
}
function JobEntry({ job, cards }: { job: PublicJobItem; cards: boolean }) {
  const titleId = useId();
  const area = job.professional_area ? areaLabel(job.professional_area) : null;
  const arrow = <ArrowUpRight data-job-arrow aria-hidden="true" className="size-5 shrink-0" />;
  return <Link href={`/vacantes/${job.id}`} aria-labelledby={titleId} className="group/job block h-full min-w-0 rounded-3xl outline-none hover:ring-1 hover:ring-ring/50 focus-visible:ring-2 focus-visible:ring-ring">
    {cards ? <Card className="h-full"><CardHeader>{area && <CardDescription>{area}</CardDescription>}<CardTitle><h3 id={titleId}>{job.title}</h3></CardTitle><CardAction>{arrow}</CardAction></CardHeader><CardContent><JobMeta job={job} /></CardContent><CardFooter className="mt-auto"><JobDate date={job.published_at} /></CardFooter></Card> : <Item variant="default"><ItemContent className="min-w-0">{area && <p className="text-xs text-muted-foreground">{area}</p>}<ItemTitle className="line-clamp-none"><h4 id={titleId}>{job.title}</h4></ItemTitle><ItemDescription className="line-clamp-none"><JobMeta job={job} /></ItemDescription><JobDate date={job.published_at} /></ItemContent><ItemActions>{arrow}</ItemActions></Item>}
  </Link>;
}
function JobResults({ jobs, cards }: { jobs: PublicJobItem[]; cards: boolean }) {
  if (cards) return <ul className="grid auto-rows-fr gap-5 sm:grid-cols-2">{jobs.map(job => <li key={job.id} className="min-w-0"><JobEntry job={job} cards /></li>)}</ul>;
  return <ItemGroup className="gap-0">{jobs.map((job, index) => <Fragment key={job.id}><div role="listitem"><JobEntry job={job} cards={false} /></div>{index < jobs.length - 1 && <Separator />}</Fragment>)}</ItemGroup>;
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
export function CompanyJobs({ jobs, variant = "list" }: { jobs: PublicJobItem[]; variant?: "list" | "cards" | "by_area" }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [open, setOpen] = useState(false);
  const id = useId();
  const shown = filterCompanyJobs(jobs, filters);
  const states = useMemo(() => [...new Map(jobs.flatMap(job => job.location?.state ? [[job.location.state.id, { value: job.location.state.id, label: job.location.state.name }] as const] : [])).values()], [jobs]);
  const clear = () => setFilters(emptyFilters());
  const count = filters.modes.length + filters.states.length;
  if (!jobs.length) return <StateCard icon={Briefcase} tone="empty" title="Por ahora no hay vacantes abiertas. Vuelve pronto." description="Las nuevas oportunidades aparecerán aquí cuando se publiquen." />;
  return <div className="flex flex-col gap-4">
    <div data-job-controls className="flex flex-col gap-3 md:flex-row md:items-end">
    <Field className="min-w-0 md:flex-1"><FieldLabel htmlFor={id}>Buscar por título</FieldLabel><InputGroup className="min-h-10"><InputGroupInput id={id} value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon></InputGroup></Field>
    {/* Sheet-demo: the root owns only its trigger/panel, never the results. */}
    <Sheet open={open} onOpenChange={setOpen}><SheetTrigger render={<Button variant="outline" className="min-h-10 self-start md:self-end" />}><SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Filtros{count ? ` (${count})` : ""}</SheetTrigger>
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
    </div>
    <p role="status" className="text-sm text-muted-foreground">{shown.length === 1 ? "1 vacante" : `${shown.length} vacantes`}</p>
    {shown.length ? <div aria-label="Vacantes de la empresa" className="flex flex-col gap-8">{variant === "by_area" ? [...new Set(shown.map(job => job.professional_area))].map(area => <section key={area ?? "other"} className="flex flex-col gap-4"><div className="flex items-center gap-3"><h3 className="text-xl font-medium">{areaLabel(area)}</h3><Badge variant="secondary">{shown.filter(job => job.professional_area === area).length}</Badge></div><JobResults jobs={shown.filter(job => job.professional_area === area)} cards={false} /></section>) : <JobResults jobs={shown} cards={variant === "cards"} />}</div> : <StateCard icon={Search} tone="empty" title="No encontramos vacantes con estos filtros." description="Prueba otra búsqueda o consulta todas las oportunidades." primaryAction={{ label: "Quitar filtros", onClick: clear }} />}
  </div>;
}
