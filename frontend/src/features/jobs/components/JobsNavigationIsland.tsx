"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MapPinIcon, SearchIcon } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { Field, FieldGroup, FieldLabel } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../../components/ui/sheet";
import { cn } from "../../../lib/utils";
import {
  employmentTypeLabel,
  seniorityLabel,
  workModeLabel,
  type EmploymentType,
  type Seniority,
  type WorkMode,
} from "../formatters";
import { buildFilterCommitUrl } from "../url";
import type { JobsQuery, JobsQueryKey } from "../url";

/**
 * The single pending-navigation island for /vacantes: it owns every
 * client-side URL navigation (search commits, quick-chip and scalar-filter
 * commits, and the next link) plus the Base UI filter/Sheet composition, while
 * fetched job data stays server-rendered `children`. URL state is owned by the
 * feature URL helpers through `buildFilterCommitUrl`; nothing is cached
 * client-side.
 */
export function JobsNavigationIsland({
  children,
  routeKey,
  query,
}: {
  children: React.ReactNode;
  routeKey: string;
  query?: JobsQuery;
}) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [pending, setPending] = React.useState<{
    routeKey: string;
    submitter: HTMLButtonElement | null;
    link: HTMLAnchorElement | null;
  } | null>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);

  // Pending clears only when the canonical route changes, which also restores
  // the initiating control and the clicked next link.
  React.useEffect(() => {
    if (!pending || pending.routeKey === routeKey) return;
    if (pending.submitter) pending.submitter.disabled = false;
    pending.link?.removeAttribute("aria-busy");
    setPending(null);
  }, [pending, routeKey]);

  function startNavigation(
    url: string,
    submitter: HTMLButtonElement | null,
    link: HTMLAnchorElement | null,
  ) {
    if (!link && url === routeKey) return;
    if (submitter) submitter.disabled = true;
    link?.setAttribute("aria-busy", "true");
    setPending({ routeKey, submitter, link });
    startTransition(() => router.push(url));
  }

  function submitterOf(event: React.SyntheticEvent): HTMLButtonElement | null {
    const native = event.nativeEvent;
    return native instanceof SubmitEvent
      ? (native.submitter as HTMLButtonElement | null)
      : null;
  }

  /** Commits the form's scalar patch through the feature URL helpers. */
  function handleOwnedSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const patch: Partial<Record<JobsQueryKey, string>> = {};
    for (const [key, value] of data.entries()) {
      if (typeof value === "string" && key !== "cursor")
        patch[key as JobsQueryKey] = value;
    }
    startNavigation(
      buildFilterCommitUrl(routeKey, patch),
      submitterOf(event),
      null,
    );
    if (form.dataset.navIntent === "mobile-filters") setFiltersOpen(false);
  }

  // Generic boundary for non-island forms (their declared `action` is the
  // destination): keeps the committed fixture contract without island state.
  function handleRootSubmitCapture(event: React.FormEvent<HTMLDivElement>) {
    const form = event.target as HTMLFormElement;
    if (form.dataset.navIntent) return;
    event.preventDefault();
    const action = form.getAttribute("action");
    if (!action) return;
    startNavigation(action, submitterOf(event), null);
  }

  // Generic boundary for child anchors: in the real composition only the
  // structurally marked next link is intercepted, and native semantics
  // (modified clicks, targets, downloads) always win over pending navigation.
  function handleRootClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      "a[href]",
    );
    const href = anchor?.getAttribute("href");
    if (!anchor || !href) return;
    if (query && anchor.dataset.jobsNextLink === undefined) return;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      anchor.target ||
      anchor.hasAttribute("download")
    ) {
      return;
    }
    event.preventDefault();
    startNavigation(href, null, anchor);
  }

  const status = (
    <p
      role="status"
      aria-live="polite"
      className="min-h-6 text-sm text-muted-foreground"
    >
      {pending ? "Cargando…" : ""}
    </p>
  );

  if (query === undefined) {
    return (
      <div
        onSubmitCapture={handleRootSubmitCapture}
        onClickCapture={handleRootClickCapture}
      >
        {status}
        {children}
      </div>
    );
  }

  return (
    <div
      onSubmitCapture={handleRootSubmitCapture}
      onClickCapture={handleRootClickCapture}
      className="flex flex-col gap-6"
    >
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        {/* One composed search surface: accessible q and location inputs plus
            the Buscar commit, styled as a single raised field group. The
            pending live region hangs absolutely in the intentional
            search-to-chips gap, so the idle state consumes no layout height. */}
        <form
          data-nav-intent="search"
          onSubmit={handleOwnedSubmit}
          className="relative flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-3 md:flex-row md:items-center"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border/60 bg-background/60 px-3.5 py-2.5 transition-colors focus-within:border-ring">
            <SearchIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <label htmlFor="jobs-search" className="sr-only">
                Buscar vacantes
              </label>
              <Input
                id="jobs-search"
                name="q"
                defaultValue={query.q ?? ""}
                placeholder="Puesto o palabra clave"
                className="h-auto border-0 bg-transparent px-0 focus-visible:bg-transparent md:text-sm"
              />
            </div>
          </div>
          <div
            aria-hidden="true"
            className="hidden h-8 w-px bg-border md:block"
          />
          <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border/60 bg-background/60 px-3.5 py-2.5 transition-colors focus-within:border-ring">
            <MapPinIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <label htmlFor="jobs-location" className="sr-only">
                Ubicación
              </label>
              <Input
                id="jobs-location"
                name="location"
                defaultValue={query.location ?? ""}
                placeholder="Ciudad o estado"
                className="h-auto border-0 bg-transparent px-0 focus-visible:bg-transparent md:text-sm"
              />
            </div>
          </div>
          <Button type="submit" size="lg" className="w-full md:w-auto">
            <SearchIcon data-icon="inline-start" />
            Buscar
          </Button>
          <div className="absolute left-0 top-full">{status}</div>
        </form>

        {/* Supported quick chips only: each commits its scalar patch through
            the same canonical navigation pipeline as the forms, one line per
            chip, and the pressed state mirrors the canonical query. */}
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_FILTER_CHIPS.map((chip) => {
            const active = chip.isActive(query);
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={active}
                onClick={(event) =>
                  startNavigation(
                    buildFilterCommitUrl(routeKey, chip.patch),
                    event.currentTarget,
                    null,
                  )
                }
                className={cn(
                  "inline-flex h-9 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors",
                  active
                    ? "border-primary/60 bg-primary/15 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-6">
          {/* Desktop sticky filter surface: supported scalar fields only,
              grouped with a separator, beside the flexible results column. */}
          <form
            data-nav-intent="filters"
            onSubmit={handleOwnedSubmit}
            aria-label="Filtros"
            className="hidden w-full shrink-0 flex-col gap-5 rounded-2xl border border-border bg-card/60 p-5 md:sticky md:top-24 md:flex md:w-60"
          >
            <FieldGroup className="w-full items-start gap-4">
              <FilterFields idPrefix="desktop-" query={query} />
            </FieldGroup>
            <div className="flex flex-col gap-2">
              <Button type="submit">Aplicar filtros</Button>
              <Button render={<a href="/vacantes" />} variant="ghost">
                Limpiar filtros
              </Button>
            </div>
          </form>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">
                Vacantes disponibles
              </h2>
              <SheetTrigger
                render={
                  <Button variant="outline" className="h-11 md:hidden">
                    Filtros
                  </Button>
                }
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">{children}</div>
          </div>
        </div>

        <SheetContent side="right" showCloseButton={false} className="gap-0">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
          </SheetHeader>
          <form
            data-nav-intent="mobile-filters"
            onSubmit={handleOwnedSubmit}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6"
          >
            <FieldGroup className="gap-4">
              <FilterFields idPrefix="mobile-" query={query} />
            </FieldGroup>
            <Button type="submit">Aplicar filtros</Button>
            <Button render={<a href="/vacantes" />} variant="ghost">
              Limpiar filtros
            </Button>
          </form>
          <div className="px-6 pb-6">
            <SheetClose
              render={
                <Button variant="outline" className="h-11 w-full">
                  Cerrar filtros
                </Button>
              }
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

type QuickFilterChip = {
  label: string;
  /** Scalar patch committed through `buildFilterCommitUrl`. */
  patch: Partial<Record<Exclude<JobsQueryKey, "cursor">, string>>;
  /** Whether the chip honestly reflects the current canonical query. */
  isActive: (query: JobsQuery) => boolean;
};

/** The only supported quick chips: full reset plus one scalar value each. */
const QUICK_FILTER_CHIPS: ReadonlyArray<QuickFilterChip> = [
  {
    // Honest full reset: clears all six filters (the helper always drops the
    // cursor), active only when the canonical query is completely empty.
    label: "Todas",
    patch: {
      q: "",
      seniority: "",
      work_mode: "",
      employment_type: "",
      location: "",
      currency: "",
    },
    isActive: (query) => Object.keys(query).length === 0,
  },
  {
    label: "Remoto",
    patch: { work_mode: "remote" },
    isActive: (query) => query.work_mode === "remote",
  },
  {
    label: "Híbrido",
    patch: { work_mode: "hybrid" },
    isActive: (query) => query.work_mode === "hybrid",
  },
  {
    label: "Tiempo completo",
    patch: { employment_type: "full_time" },
    isActive: (query) => query.employment_type === "full_time",
  },
  {
    label: "Medio",
    patch: { seniority: "mid" },
    isActive: (query) => query.seniority === "mid",
  },
  {
    label: "Senior",
    patch: { seniority: "senior" },
    isActive: (query) => query.seniority === "senior",
  },
];

const SENIORITY_OPTIONS: ReadonlyArray<{ value: Seniority }> = [
  { value: "intern" },
  { value: "junior" },
  { value: "mid" },
  { value: "senior" },
  { value: "lead" },
];

const WORK_MODE_OPTIONS: ReadonlyArray<{ value: WorkMode }> = [
  { value: "onsite" },
  { value: "remote" },
  { value: "hybrid" },
];

const EMPLOYMENT_TYPE_OPTIONS: ReadonlyArray<{ value: EmploymentType }> = [
  { value: "full_time" },
  { value: "part_time" },
  { value: "contract" },
  { value: "internship" },
];

const CURRENCY_OPTIONS = ["MXN", "USD"] as const;

function FilterFields({
  idPrefix,
  query,
}: {
  idPrefix: string;
  query: JobsQuery;
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}work-mode`}>Modalidad</FieldLabel>
        <Select name="work_mode" defaultValue={query.work_mode}>
          <SelectTrigger id={`${idPrefix}work-mode`}>
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={null}>Todas</SelectItem>
              {WORK_MODE_OPTIONS.map(({ value }) => (
                <SelectItem key={value} value={value}>
                  {workModeLabel(value)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}seniority`}>Senioridad</FieldLabel>
        <Select name="seniority" defaultValue={query.seniority}>
          <SelectTrigger id={`${idPrefix}seniority`}>
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={null}>Todas</SelectItem>
              {SENIORITY_OPTIONS.map(({ value }) => (
                <SelectItem key={value} value={value}>
                  {seniorityLabel(value)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}employment-type`}>
          Tipo de empleo
        </FieldLabel>
        <Select name="employment_type" defaultValue={query.employment_type}>
          <SelectTrigger id={`${idPrefix}employment-type`}>
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={null}>Todos</SelectItem>
              {EMPLOYMENT_TYPE_OPTIONS.map(({ value }) => (
                <SelectItem key={value} value={value}>
                  {employmentTypeLabel(value)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}location`}>Ubicación</FieldLabel>
        <Input
          id={`${idPrefix}location`}
          name="location"
          defaultValue={query.location ?? ""}
          placeholder="Ciudad o estado"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}currency`}>Moneda</FieldLabel>
        <Select name="currency" defaultValue={query.currency}>
          <SelectTrigger id={`${idPrefix}currency`}>
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={null}>Todas</SelectItem>
              {CURRENCY_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}
