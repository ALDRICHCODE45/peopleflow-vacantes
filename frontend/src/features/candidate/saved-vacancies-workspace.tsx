import Link from "next/link";
import { ArrowUpRight, Bookmark, Briefcase, Building2, Globe, GraduationCap, MapPin, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DashboardPageContent } from "@/components/dashboard-page-content";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { PrototypeJobView } from "@/features/jobs/enrich";
import { employmentTypeLabel, formatSalary, seniorityLabel, workModeLabel } from "@/features/jobs/formatters";

/**
 * Props-only, read-only candidate saved-vacancies surface for
 * `/candidato/guardadas`. Every card derives from `savedVacancies` and the
 * shipped job formatters; the surface owns no fetch, storage, timer, router
 * mutation, form or save/remove control, and the canonical fixtures are
 * supplied by the server route boundary. The whole list is a single
 * presentation: a responsive one/two column grid of rich vertical cards.
 */
export type SavedVacanciesWorkspaceProps = Readonly<{ savedVacancies: readonly PrototypeJobView[] }>;

/** One labelled fact: a functional icon with the quiet term, then the value. */
type SavedVacancyFact = { readonly key: string; readonly label: string; readonly icon: LucideIcon; readonly value: string };

/** Contextual icon per wire work mode, mirroring the public vacancy card. */
const WORK_MODE_ICONS = {
  onsite: MapPin,
  remote: Globe,
  hybrid: Building2,
} as const satisfies Record<PrototypeJobView["work_mode"], LucideIcon>;

/** Quiet field term: it never competes with the value it labels. */
const META = "text-[12.5px] font-medium text-muted-foreground";
/** Card metadata: one column on mobile, two columns from `sm` up. */
const CARD_FACTS = "grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2";
/** Circular identity medallion that anchors each saved vacancy. */
const IDENTITY = "grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary";
/**
 * Vacancy navigation keeps the anchor element and its link role: the shadcn
 * Button contract (variants, focus ring, `data-slot`) is applied to the Next
 * Link instead of routing it through the Base UI Button, which would relabel
 * the navigation as a non-native button.
 */
const VACANCY_LINK = buttonVariants({ variant: "outline", size: "sm" });

/**
 * The facts one saved vacancy actually carries, in reading order. The three wire
 * enums always exist and go through the shipped formatters; salary and location
 * are optional wire fields, so a vacancy without them simply renders fewer
 * facts instead of an invented placeholder.
 */
function vacancyFacts(job: PrototypeJobView): readonly SavedVacancyFact[] {
  const salary = formatSalary({ min: job.salary_min, max: job.salary_max, currency: job.salary_currency });
  const facts: SavedVacancyFact[] = [
    { key: "work-mode", label: "Modalidad", icon: WORK_MODE_ICONS[job.work_mode], value: workModeLabel(job.work_mode) },
    { key: "employment-type", label: "Tipo de empleo", icon: Briefcase, value: employmentTypeLabel(job.employment_type) },
    { key: "seniority", label: "Nivel", icon: GraduationCap, value: seniorityLabel(job.seniority) },
  ];
  if (job.location !== undefined) {
    facts.push({ key: "location", label: "Ubicación", icon: MapPin, value: job.location });
  }
  if (salary !== null) {
    facts.push({ key: "salary", label: "Salario", icon: Wallet, value: salary });
  }
  return facts;
}

/** One labelled fact row of the card metadata definition list. */
function Fact({ icon: Icon, label, value }: { readonly icon: LucideIcon; readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className={`flex items-center gap-1.5 ${META}`}>
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </dt>
      <dd className="mt-1 text-foreground">{value}</dd>
    </div>
  );
}

/**
 * One saved vacancy as a rich vertical Card: the identity medallion with the
 * title and company in the header, the labelled wire facts in the divided
 * content, and exactly one canonical `Ver vacante` link in the footer. The grid
 * parent owns the responsive one/two column layout.
 */
function SavedVacancyCard({ job }: { readonly job: PrototypeJobView }) {
  return (
    <Card data-pf-saved-vacancy={job.id} className="h-full">
      <CardHeader className="border-b">
        <div className="flex min-w-0 items-start gap-3">
          <span data-pf-saved-vacancy-identity aria-hidden="true" className={IDENTITY}>
            <Bookmark className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitle>
              <h3 className="font-heading text-base font-semibold text-foreground">{job.title}</h3>
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{job.company.name}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl data-pf-saved-vacancy-metadata={job.id} className={CARD_FACTS}>
          {vacancyFacts(job).map((fact) => (
            <Fact key={fact.key} icon={fact.icon} label={fact.label} value={fact.value} />
          ))}
        </dl>
      </CardContent>
      <CardFooter className="mt-auto justify-end border-t">
        <Link
          href={`/vacantes/${job.id}`}
          data-slot="button"
          aria-label={`Ver vacante de ${job.title} en ${job.company.name}`}
          className={`${VACANCY_LINK} min-h-10`}
        >
          Ver vacante
          <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </CardFooter>
    </Card>
  );
}

/** Read-only saved vacancies surface over the passed props. */
export function SavedVacanciesWorkspace({ savedVacancies }: SavedVacanciesWorkspaceProps) {
  return (
    <DashboardPageContent data-pf-saved-vacancies-workspace width="screen-2xl" className="gap-5">
      <header data-pf-saved-vacancies-intro className="flex flex-col gap-2">
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Vacantes guardadas</h2>
        <p className="text-sm text-muted-foreground">Las vacantes que guardaste para revisarlas con calma.</p>
      </header>
      {savedVacancies.length === 0 ? (
        <Empty data-pf-saved-vacancies-empty className="border border-dashed border-border bg-card p-6">
          <EmptyHeader>
            <EmptyTitle>Todavía no tienes vacantes guardadas</EmptyTitle>
            <EmptyDescription>Cuando guardes una vacante, va a aparecer en este listado.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div data-pf-saved-vacancies-grid className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {savedVacancies.map((job) => (<SavedVacancyCard key={job.id} job={job} />))}
        </div>
      )}
    </DashboardPageContent>
  );
}
