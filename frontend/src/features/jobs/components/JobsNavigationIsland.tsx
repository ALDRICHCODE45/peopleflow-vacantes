"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InfoIcon, MapPinIcon, SearchIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { CONTRACT_TYPE_OPTIONS, PROFESSIONAL_AREA_OPTIONS, WORK_MODE_OPTIONS, WORK_SCHEDULE_OPTIONS } from "../drafts/ui/draft-labels";
import { buildFilterCommitUrl, type JobsQuery, type JobsQueryKey } from "../url";

/** URL-owned navigation; server-rendered results remain mounted during navigation. */
export function JobsNavigationIsland({ children, routeKey, query }: { children: React.ReactNode; routeKey: string; query?: JobsQuery }) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [pending, setPending] = React.useState<{ routeKey: string; submitter: HTMLButtonElement | null; link: HTMLAnchorElement | null } | null>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);

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
    const patch: Partial<Record<JobsQueryKey, string>> = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value === "string" && key !== "cursor") patch[key as JobsQueryKey] = value;
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

  const excludesLegacy = Boolean(query.work_schedule || query.contract_type || query.professional_area);
  return <div data-jobs-navigation-island onSubmitCapture={handleRootSubmitCapture} onClickCapture={handleRootClickCapture} className="flex flex-col gap-6 md:-mx-[7px]">
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
      <Card>
        <CardContent>
          <form data-nav-intent="search" onSubmit={handleOwnedSubmit} className="flex flex-col gap-3 md:flex-row md:items-end">
            <FieldGroup className="md:flex-row">
              <ComposedSearchField icon={SearchIcon} id="jobs-search" label="Buscar vacantes" name="q" defaultValue={query.q ?? ""} placeholder="Puesto o palabra clave" />
              <ComposedSearchField icon={MapPinIcon} id="jobs-location" label="Ubicación" name="location" defaultValue={query.location ?? ""} placeholder="Ciudad o estado" />
            </FieldGroup>
            <Button type="submit" size="lg" className="min-h-10 w-full md:w-auto"><SearchIcon aria-hidden="true" data-icon="inline-start" />Buscar</Button>
          </form>
        </CardContent>
      </Card>
      {status}
      <ToggleGroup multiple value={QUICK_FILTERS.filter((item) => item.isActive(query)).map((item) => item.label)} variant="outline" aria-label="Filtros rápidos" className="max-w-full flex-wrap">
        {QUICK_FILTERS.map((item) => <ToggleGroupItem key={item.label} value={item.label} className="min-h-10" onClick={(event) => startNavigation(buildFilterCommitUrl(routeKey, item.patch), event.currentTarget, null)}>{item.label}</ToggleGroupItem>)}
      </ToggleGroup>
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="hidden w-full shrink-0 md:sticky md:top-24 md:block md:w-60">
          <form data-nav-intent="filters" onSubmit={handleOwnedSubmit} aria-label="Filtros">
            <Card>
              <CardHeader className="border-b"><CardTitle><h2>Filtros</h2></CardTitle></CardHeader>
              <CardContent>
                <FieldGroup className="gap-4"><FilterFields idPrefix="desktop-" query={query} /></FieldGroup>
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
            <SheetTrigger render={<Button variant="outline" className="h-11 md:hidden">Filtros</Button>} />
          </div>
          {excludesLegacy && <p role="note" className="flex items-start gap-2 text-sm text-muted-foreground"><InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Algunas vacantes del catálogo anterior no tienen este dato y no aparecen con este filtro.</p>}
          <div className="flex min-w-0 flex-col gap-2">{children}</div>
        </div>
      </div>
      <SheetContent side="right" showCloseButton={false} className="gap-0">
        <SheetHeader><SheetTitle>Filtros</SheetTitle></SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          <form data-nav-intent="mobile-filters" onSubmit={handleOwnedSubmit} className="flex flex-col gap-4">
            <FieldGroup className="gap-4"><FilterFields idPrefix="mobile-" query={query} /></FieldGroup>
            <Button type="submit" className="min-h-10">Aplicar filtros</Button>
            <Link href="/vacantes" className={cn(buttonVariants({ variant: "ghost" }), "min-h-10")}>Limpiar filtros</Link>
          </form>
        </div>
        <div className="px-6 pb-6"><SheetClose render={<Button variant="outline" className="h-11 w-full">Cerrar filtros</Button>} /></div>
      </SheetContent>
    </Sheet>
  </div>;
}

function ComposedSearchField({ icon: Icon, id, label, name, defaultValue, placeholder }: { icon: typeof SearchIcon; id: string; label: string; name: "q" | "location"; defaultValue: string; placeholder: string }) {
  return <Field className="min-w-0 flex-1" data-jobs-composed-field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <InputGroup className="min-h-10"><InputGroupInput id={id} name={name} defaultValue={defaultValue} placeholder={placeholder} className="min-h-10" /><InputGroupAddon><Icon aria-hidden="true" /></InputGroupAddon></InputGroup>
  </Field>;
}

const QUICK_FILTERS = [
  { label: "Todas", patch: { q: "", location: "", work_mode: "", work_schedule: "", contract_type: "", professional_area: "" }, isActive: (query: JobsQuery) => Object.keys(query).length === 0 },
  { label: "Remoto", patch: { work_mode: "remote" }, isActive: (query: JobsQuery) => query.work_mode === "remote" },
  { label: "Híbrido", patch: { work_mode: "hybrid" }, isActive: (query: JobsQuery) => query.work_mode === "hybrid" },
  { label: "Tiempo completo", patch: { work_schedule: "full_time" }, isActive: (query: JobsQuery) => query.work_schedule === "full_time" },
] satisfies { label: string; patch: Partial<Record<Exclude<JobsQueryKey, "cursor">, string>>; isActive: (query: JobsQuery) => boolean }[];

const FILTERS = [
  { key: "work_mode", label: "Modalidad", options: WORK_MODE_OPTIONS },
  { key: "work_schedule", label: "Jornada", options: WORK_SCHEDULE_OPTIONS },
  { key: "contract_type", label: "Tipo de contrato", options: CONTRACT_TYPE_OPTIONS },
  { key: "professional_area", label: "Área profesional", options: PROFESSIONAL_AREA_OPTIONS },
] as const;

function FilterFields({ idPrefix, query }: { idPrefix: string; query: JobsQuery }) {
  return <>
    {FILTERS.map(({ key, label, options }) => {
      const items = [{ value: null, label: "Todas las opciones" }, ...options];
      return <Field key={key}>
        <FieldLabel htmlFor={`${idPrefix}${key}`}>{label}</FieldLabel>
        <Select name={key} defaultValue={query[key] ?? null} items={items}>
          <SelectTrigger id={`${idPrefix}${key}`} className="min-h-10 w-full"><SelectValue placeholder="Todas las opciones" /></SelectTrigger>
          <SelectContent><SelectGroup>{items.map((item) => <SelectItem key={item.label} value={item.value} className="min-h-10">{item.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>;
    })}
    <Field><FieldLabel htmlFor={`${idPrefix}location`}>Ubicación</FieldLabel><Input id={`${idPrefix}location`} name="location" defaultValue={query.location ?? ""} placeholder="Ciudad o estado" className="min-h-10" /></Field>
  </>;
}
