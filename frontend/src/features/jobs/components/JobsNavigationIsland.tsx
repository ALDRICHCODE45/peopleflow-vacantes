"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilterIcon, InfoIcon, MapPinIcon, SearchIcon, BriefcaseBusinessIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { CONTRACT_TYPE_OPTIONS, PROFESSIONAL_AREA_OPTIONS, WORK_SCHEDULE_OPTIONS } from "../drafts/ui/draft-labels";
import { buildFilterCommitUrl, selectedValues, type JobsQuery, type JobsFilterPatch } from "../url";
import { JobsGeoFields, JobsFilterChips, useJobsGeo } from "./JobsGeoFilters";
import { CLEAR_SALARY_FILTER, hasSalaryFilter, JobsSalaryFilter, JobsSalaryFilterChip, validateSalaryFilter, type SalaryErrors } from "./JobsSalaryFilter";

/** URL-owned navigation; server-rendered results remain mounted during navigation. */
export function JobsNavigationIsland({ children, routeKey, query }: { children: React.ReactNode; routeKey: string; query?: JobsQuery }) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [pending, setPending] = React.useState<{ routeKey: string; submitter: HTMLButtonElement | null; link: HTMLAnchorElement | null } | null>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<JobsQuery>(query ?? {});
  const [draftRoute, setDraftRoute] = React.useState(routeKey);
  const [salaryErrors, setSalaryErrors] = React.useState<SalaryErrors>({});
  if (draftRoute !== routeKey) {
    setDraftRoute(routeKey);
    setDraft(query ?? {});
    setSalaryErrors({});
  }
  const geo = useJobsGeo(query ?? {}, draft);
  const updateDraft = (patch: JobsFilterPatch) => setDraft(old => ({ ...old, ...patch }));

  React.useEffect(() => {
    if (!pending || pending.routeKey === routeKey) return;
    if (pending.submitter) pending.submitter.disabled = false;
    pending.link?.removeAttribute("aria-busy");
    setPending(null);
  }, [pending, routeKey]);

  function startNavigation(url: string, submitter: HTMLButtonElement | null, link: HTMLAnchorElement | null) {
    if (!link && url === routeKey) return;
    if (submitter) submitter.disabled = true;
    link?.setAttribute("aria-busy", "true");
    setPending({ routeKey, submitter, link });
    startTransition(() => router.push(url));
  }
  function submitterOf(event: React.SyntheticEvent): HTMLButtonElement | null {
    return event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter as HTMLButtonElement | null : null;
  }
  function handleOwnedSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const patch: JobsFilterPatch = form.dataset.navIntent === "search" ? {} : { ...draft };
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value === "string" && key !== "cursor") patch[key as keyof JobsFilterPatch] = value;
    }
    if (form.dataset.navIntent !== "search") {
      const errors = validateSalaryFilter(patch);
      setSalaryErrors(errors);
      const firstInvalidKey = Object.keys(errors)[0];
      if (firstInvalidKey) {
        form.querySelector<HTMLInputElement>(`[name="${firstInvalidKey}"]`)?.focus();
        return;
      }
    }
    startNavigation(buildFilterCommitUrl(routeKey, patch), submitterOf(event), null);
    if (form.dataset.navIntent === "mobile-filters") setFiltersOpen(false);
  }
  function handleRootSubmitCapture(event: React.FormEvent<HTMLDivElement>) {
    const form = event.target as HTMLFormElement;
    if (form.dataset.navIntent) return;
    event.preventDefault();
    const action = form.getAttribute("action");
    if (action) startNavigation(action, submitterOf(event), null);
  }
  function handleRootClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!anchor || !href || (query && anchor.dataset.jobsNextLink === undefined)) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target || anchor.hasAttribute("download")) return;
    event.preventDefault();
    startNavigation(href, null, anchor);
  }
  const status = <p role="status" aria-live="polite" className="min-h-6 text-sm text-muted-foreground">{pending ? "Cargando…" : ""}</p>;
  if (query === undefined) return <div onSubmitCapture={handleRootSubmitCapture} onClickCapture={handleRootClickCapture}>{status}{children}</div>;

  const excludesLegacy = Boolean(query.work_schedule || query.contract_type || query.professional_area || selectedValues(query.state).length || selectedValues(query.municipality).length || hasSalaryFilter(query));
  const activeCount = Object.entries(query).filter(([key]) => key !== "cursor" && !key.startsWith("salary_")).reduce((total, [, value]) => total + selectedValues(value).length, 0) + Number(hasSalaryFilter(query));
  const draftCount = Object.entries(draft).filter(([key]) => key !== "cursor" && key !== "q" && !key.startsWith("salary_")).reduce((total, [, value]) => total + selectedValues(value).filter(Boolean).length, 0) + Number(hasSalaryFilter(draft));
  const filterFields = (idPrefix: string) => <FieldGroup className="gap-4">
    <FieldSet><FieldLegend variant="label"><MapPinIcon aria-hidden="true" className="inline size-4" /> Ubicación y modalidad</FieldLegend><FieldGroup><JobsGeoFields idPrefix={idPrefix} query={draft} onChange={updateDraft} geo={geo} /></FieldGroup></FieldSet>
    <Separator />
    <FieldSet><FieldLegend variant="label"><BriefcaseBusinessIcon aria-hidden="true" className="inline size-4" /> Condiciones</FieldLegend><FieldGroup><FilterFields idPrefix={idPrefix} query={draft} onChange={updateDraft} /></FieldGroup></FieldSet>
    <Separator />
    <JobsSalaryFilter idPrefix={idPrefix} query={draft} onChange={updateDraft} errors={salaryErrors} />
    <p className="text-sm text-muted-foreground">Las opciones de un mismo filtro se suman. Entre filtros, las vacantes deben cumplir ambas condiciones.</p>
  </FieldGroup>;
  return <div data-jobs-navigation-island onSubmitCapture={handleRootSubmitCapture} onClickCapture={handleRootClickCapture} className="flex flex-col gap-6 md:-mx-[7px]">
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
      <Card>
        <CardContent>
          <form data-nav-intent="search" onSubmit={handleOwnedSubmit} className="flex flex-col gap-3 md:flex-row md:items-end">
            <FieldGroup className="md:flex-row">
              <ComposedSearchField icon={SearchIcon} id="jobs-search" label="Buscar vacantes" name="q" defaultValue={query.q ?? ""} placeholder="Puesto o palabra clave" />
            </FieldGroup>
            <Button type="submit" size="lg" className="min-h-10 w-full md:w-auto"><SearchIcon aria-hidden="true" data-icon="inline-start" />Buscar</Button>
          </form>
        </CardContent>
      </Card>
      {status}
      <ToggleGroup multiple value={QUICK_FILTERS.filter((item) => item.isActive(query)).map((item) => item.label)} variant="outline" aria-label="Filtros rápidos" className="max-w-full flex-wrap">
        {QUICK_FILTERS.map((item) => <ToggleGroupItem key={item.label} value={item.label} className="min-h-10" onClick={(event) => startNavigation(buildFilterCommitUrl(routeKey, item.patch), event.currentTarget, null)}>{item.label}</ToggleGroupItem>)}
      </ToggleGroup>
      <JobsFilterChips query={query} geo={geo} onRemove={patch => startNavigation(buildFilterCommitUrl(routeKey, patch), null, null)}>
        <JobsSalaryFilterChip query={query} onRemove={patch => startNavigation(buildFilterCommitUrl(routeKey, patch), null, null)} />
      </JobsFilterChips>
      {geo.loaders}
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="hidden w-full shrink-0 md:sticky md:top-24 md:block md:w-60">
          <form data-nav-intent="filters" onSubmit={handleOwnedSubmit} aria-label="Filtros">
            <Card>
              <CardHeader className="border-b"><CardTitle><h2>Filtros</h2></CardTitle></CardHeader>
              <CardContent>
                {filterFields("desktop-")}
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-2">
                <Button type="submit" className="min-h-10">Aplicar filtros</Button>
                <Link href="/vacantes" className={cn(buttonVariants({ variant: "ghost" }), "min-h-10")}>Limpiar filtros</Link>
              </CardFooter>
            </Card>
          </form>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">Vacantes disponibles</h2>
            <SheetTrigger render={<Button variant="outline" className="h-11 md:hidden">Filtros{activeCount ? ` (${activeCount})` : ""}</Button>} />
          </div>
          {excludesLegacy && <p role="note" className="flex items-start gap-2 text-sm text-muted-foreground"><InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Algunas vacantes del catálogo anterior no tienen este dato y no aparecen con este filtro.</p>}
          <div className="flex min-w-0 flex-col gap-2">{children}</div>
        </div>
      </div>
      <SheetContent side="right" showCloseButton={false} className="gap-0">
        <SheetHeader className="border-b"><FilterIcon aria-hidden="true" /><SheetTitle>Filtrar vacantes</SheetTitle><SheetDescription>Elige dónde y cómo quieres trabajar.</SheetDescription></SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">
          <form id="mobile-job-filters" data-nav-intent="mobile-filters" onSubmit={handleOwnedSubmit} className="flex flex-col gap-4">{filterFields("mobile-")}</form>
        </div>
        <SheetFooter className="border-t">
          <p role="status" className="text-sm text-muted-foreground">{draftCount === 1 ? "1 valor seleccionado" : `${draftCount} valores seleccionados`}. Aplica los filtros para consultar los resultados.</p>
          <Button type="submit" form="mobile-job-filters" className="min-h-10">Aplicar filtros</Button>
          <Link href="/vacantes" className={cn(buttonVariants({ variant: "ghost" }), "min-h-10")}>Limpiar filtros</Link>
          <SheetClose render={<Button variant="outline" className="h-11 w-full">Cerrar filtros</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>;
}

function ComposedSearchField({ icon: Icon, id, label, name, defaultValue, placeholder }: { icon: typeof SearchIcon; id: string; label: string; name: "q"; defaultValue: string; placeholder: string }) {
  return <Field className="min-w-0 flex-1" data-jobs-composed-field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <InputGroup className="min-h-10"><InputGroupInput id={id} name={name} defaultValue={defaultValue} placeholder={placeholder} className="min-h-10" /><InputGroupAddon><Icon aria-hidden="true" /></InputGroupAddon></InputGroup>
  </Field>;
}

const QUICK_FILTERS = [
  { label: "Todas", patch: { ...CLEAR_SALARY_FILTER, q: "", state: [], municipality: [], applicant_country: "", work_mode: [], work_schedule: "", contract_type: "", professional_area: "" }, isActive: (query: JobsQuery) => Object.keys(query).length === 0 },
  { label: "Remoto", patch: { work_mode: "remote" }, isActive: (query: JobsQuery) => selectedValues(query.work_mode).includes("remote") },
  { label: "Híbrido", patch: { work_mode: "hybrid" }, isActive: (query: JobsQuery) => selectedValues(query.work_mode).includes("hybrid") },
  { label: "Tiempo completo", patch: { work_schedule: "full_time" }, isActive: (query: JobsQuery) => query.work_schedule === "full_time" },
] satisfies { label: string; patch: JobsFilterPatch; isActive: (query: JobsQuery) => boolean }[];

const FILTERS = [
  { key: "work_schedule", label: "Jornada", options: WORK_SCHEDULE_OPTIONS },
  { key: "contract_type", label: "Tipo de contrato", options: CONTRACT_TYPE_OPTIONS },
  { key: "professional_area", label: "Área profesional", options: PROFESSIONAL_AREA_OPTIONS },
] as const;

function FilterFields({ idPrefix, query, onChange }: { idPrefix: string; query: JobsQuery; onChange: (patch: JobsFilterPatch) => void }) {
  return <>
    {FILTERS.map(({ key, label, options }) => {
      const items = [{ value: null, label: "Todas las opciones" }, ...options];
      return <Field key={key}>
        <FieldLabel htmlFor={`${idPrefix}${key}`}>{label}</FieldLabel>
        <Select name={key} value={query[key] || null} onValueChange={value => onChange({ [key]: value ?? "" })} items={items}>
          <SelectTrigger id={`${idPrefix}${key}`} className="min-h-10 w-full"><SelectValue placeholder="Todas las opciones" /></SelectTrigger>
          <SelectContent className="min-w-max"><SelectGroup>{items.map((item) => <SelectItem key={item.label} value={item.value} className="min-h-10">{item.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>;
    })}
  </>;
}
