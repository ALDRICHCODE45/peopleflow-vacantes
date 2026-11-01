import { Suspense, use, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon, MapPinIcon, SearchIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PublicCompanyAvatar } from "../components/PublicCompanyAvatar";
import { PublicApplyLink } from "../components/public-apply-link";
import { PublicJobDetailView } from "../components/PublicJobDetailView";
import { formatPublicSalaryParts, workModeLabel } from "../formatters";
import type { PublicJobDetail, PublicJobItem } from "../types";
import { deriveRelatedSearches } from "./chips";
import type { RelatedCompany, RelatedResult } from "./read";

type CompanyProps = { company: RelatedResult<RelatedCompany>; vacancies: RelatedResult<PublicJobItem[]> };
type ExploreProps = { job: PublicJobDetail; company: Promise<RelatedResult<RelatedCompany>>; companyVacancies: Promise<RelatedResult<PublicJobItem[]>>; similar: Promise<RelatedResult<PublicJobItem[]>> };
const focus = "rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const similarGrid = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";
const sectionHeading = "font-heading text-xl font-semibold tracking-tight";

function Conditions({ job }: { job: PublicJobItem }) {
  return <p className="flex items-start gap-2 text-xs text-muted-foreground"><MapPinIcon aria-hidden="true" className="size-4 shrink-0" /><span>{[job.location_label, workModeLabel(job.work_mode)].filter(Boolean).join(" · ")}</span></p>;
}
function Salary({ job }: { job: PublicJobItem }) {
  const salary = formatPublicSalaryParts(job);
  return salary ? <div className="flex flex-col gap-1"><p className="font-semibold tabular-nums">{salary.amount} {salary.currency}</p>{salary.cadence && <p className="text-xs text-muted-foreground">{salary.cadence}</p>}</div> : <p className="text-sm text-muted-foreground">Salario no publicado</p>;
}

export function CompanySection({ company, vacancies }: CompanyProps) {
  if (!company.ok) return null;
  const profile = company.data;
  const jobs = vacancies.ok ? vacancies.data.slice(0, 3) : [];
  const description = profile.description?.trim();
  if (!description && !profile.careersHref && jobs.length === 0) return null;
  return <section aria-labelledby="related-company-heading">
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-3"><PublicCompanyAvatar company={profile} /><h2 id="related-company-heading" className="min-w-0 break-words text-lg font-semibold">Sobre {profile.name}</h2></CardTitle>
        {description && <CardDescription className="whitespace-pre-wrap break-words leading-relaxed">{profile.description}</CardDescription>}
      </CardHeader>
      {jobs.length > 0 && <CardContent>
        <h3 className="mb-3 font-semibold">Más vacantes de {profile.name}</h3>
        <ul className="flex flex-col gap-3">{jobs.map(job => <li key={job.id} className="min-w-0 border-t border-border pt-3">
          <Link href={`/vacantes/${job.id}`} className={`flex min-w-0 flex-col gap-2 p-1 hover:bg-muted ${focus}`}>
            <h4 className="font-medium break-words">{job.title}</h4><Conditions job={job} /><Salary job={job} />
          </Link>
        </li>)}</ul>
      </CardContent>}
      {profile.careersHref && <CardFooter className="border-t"><Link href={profile.careersHref} className={buttonVariants({ variant: "link", className: "min-h-10" })}>Conoce la empresa<ArrowRightIcon aria-hidden="true" data-icon="inline-end" /></Link></CardFooter>}
    </Card>
  </section>;
}

function CompactCard({ job }: { job?: PublicJobItem }) {
  // Skeletons share the exact Card parts and layout of the linked result.
  const card = <Card size="sm" className="h-full">
    <CardHeader>
      <CardTitle className="flex min-w-0 items-start gap-3">
        {job ? <PublicCompanyAvatar company={job.company} /> : <Skeleton aria-hidden="true" className="size-12 shrink-0 rounded-xl" />}
        <div className="min-w-0 flex-1">{job ? <h3 className="line-clamp-2 min-h-10 text-sm font-medium break-words">{job.title}</h3> : <Skeleton aria-hidden="true" className="h-10 w-full" />}</div>
      </CardTitle>
      <CardDescription>{job ? job.company.name : <Skeleton aria-hidden="true" className="h-4 w-28 max-w-full" />}</CardDescription>
    </CardHeader>
    <CardContent>{job ? <Conditions job={job} /> : <Skeleton aria-hidden="true" className="h-4 w-full" />}</CardContent>
    <CardFooter className="border-t">{job ? <Salary job={job} /> : <div className="flex w-full flex-col gap-1"><Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" /><Skeleton aria-hidden="true" className="h-4 w-24 max-w-full" /></div>}</CardFooter>
  </Card>;
  return job ? <Link href={`/vacantes/${job.id}`} className={`block h-full transition-shadow hover:shadow-md ${focus}`}>{card}</Link> : card;
}
export function SimilarSection({ result }: { result: RelatedResult<PublicJobItem[]> }) {
  if (!result.ok || result.data.length === 0) return null;
  return <section aria-labelledby="related-similar-heading" className="flex flex-col gap-4">
    <h2 id="related-similar-heading" className={sectionHeading}>Vacantes similares</h2>
    <ul className={similarGrid}>{result.data.slice(0, 3).map(job => <li key={job.id} className="min-w-0"><CompactCard job={job} /></li>)}</ul>
  </section>;
}
export function CompanySkeleton() {
  return <section aria-busy="true" aria-label="Empresa y sus vacantes">
    <span role="status" className="sr-only">Cargando empresa y sus vacantes</span>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3"><Skeleton aria-hidden="true" className="size-12 shrink-0 rounded-xl" /><Skeleton aria-hidden="true" className="h-7 w-40 max-w-full" /></CardTitle>
        <CardDescription><Skeleton aria-hidden="true" className="h-12 w-full" /></CardDescription>
      </CardHeader>
      <CardContent><Skeleton aria-hidden="true" className="mb-3 h-5 w-48 max-w-full" /><ul className="flex flex-col gap-3">{[0, 1, 2].map(key => <li key={key} className="flex flex-col gap-2 border-t border-border p-1 pt-3"><Skeleton aria-hidden="true" className="h-5 w-3/4" /><Skeleton aria-hidden="true" className="h-4 w-2/3" /><div className="flex flex-col gap-1"><Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" /><Skeleton aria-hidden="true" className="h-4 w-24 max-w-full" /></div></li>)}</ul></CardContent>
    </Card>
  </section>;
}
export function SimilarSkeleton() {
  return <section aria-busy="true" aria-label="Vacantes similares" className="flex flex-col gap-4">
    <span role="status" className="sr-only">Cargando vacantes similares</span>
    <Skeleton aria-hidden="true" className="h-7 w-48 max-w-full" />
    <ul className={similarGrid}>{[0, 1, 2].map(key => <li key={key} className="min-w-0"><CompactCard /></li>)}</ul>
  </section>;
}
export function RelatedSearches({ job }: { job: PublicJobDetail }) {
  const chips = deriveRelatedSearches(job);
  if (chips.length === 0) return null;
  return <section aria-labelledby="related-search-heading" className="flex flex-col gap-4">
    <h2 id="related-search-heading" className={sectionHeading}>Sigue buscando</h2>
    <nav aria-label="Búsquedas relacionadas" className="flex flex-wrap gap-2">{chips.map(chip => <Link key={chip.href} href={chip.href} className={buttonVariants({ variant: "outline", className: "min-h-10 max-w-full" })}><SearchIcon aria-hidden="true" data-icon="inline-start" /><span className="min-w-0 truncate" title={chip.label}>{chip.label}</span></Link>)}</nav>
  </section>;
}
export function MobileApplyBar({ job }: { job: PublicJobDetail }) {
  if (job.source === "legacy") return null;
  return <div className="pb-32 lg:pb-0">
    <section aria-labelledby="mobile-apply-heading" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <h2 id="mobile-apply-heading" className="sr-only">Postulación móvil</h2>
      <div className="mx-auto max-w-lg"><PublicApplyLink jobId={job.id} /></div>
    </section>
  </div>;
}
function PendingCompany({ company, companyVacancies }: Pick<ExploreProps, "company" | "companyVacancies">) {
  const profile = use(company);
  const vacancies = use(companyVacancies);
  return <CompanySection company={profile} vacancies={vacancies} />;
}
function PendingSimilar({ result }: { result: ExploreProps["similar"] }) {
  return <SimilarSection result={use(result)} />;
}
function ExplorationLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-8">{children}</div>;
}
/** Promises start in the route, after its single detail read; no await gates the detail. */
export function ExploreDetail({ job, company, companyVacancies, similar }: ExploreProps) {
  return <ExplorationLayout>
    <PublicJobDetailView job={job} belowContent={<Suspense fallback={<CompanySkeleton />}><PendingCompany company={company} companyVacancies={companyVacancies} /></Suspense>} />
    <Suspense fallback={<SimilarSkeleton />}><PendingSimilar result={similar} /></Suspense>
    <RelatedSearches job={job} />
    <MobileApplyBar job={job} />
  </ExplorationLayout>;
}
