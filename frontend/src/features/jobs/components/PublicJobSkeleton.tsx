import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatPublicSalary } from "../formatters";
import type { PublicJobDetail, PublicJobItem } from "../types";
import { publicJobChips, publicJobFacts } from "./public-job-facts";
import { PUBLIC_VACANCY_CARD, PUBLIC_VACANCY_CHIPS, PUBLIC_VACANCY_CONTENT, PUBLIC_VACANCY_DESCRIPTION, PUBLIC_VACANCY_HEADER, PUBLIC_VACANCY_META, PUBLIC_VACANCY_RAIL, PUBLIC_VACANCY_TITLE, type PublicVacancyCardExtras } from "./public-vacancy-layout";

/** When the projection is known, reserve only its actual optional blocks. */
type CardSkeletonProps = { job?: PublicJobItem } & PublicVacancyCardExtras;

function IdentitySkeleton({ detail = false }: { detail?: boolean }) {
  return <CardHeader className="border-b">
    <CardTitle><div className={detail ? "flex items-start gap-4" : "flex items-start gap-3"}>
      <Skeleton aria-hidden="true" className="size-10 shrink-0 rounded-full" />
      <Skeleton aria-hidden="true" className={detail ? "h-9 w-3/4 md:h-10" : "h-10 w-3/4"} />
    </div></CardTitle>
    <CardDescription><Skeleton aria-hidden="true" className="h-5 w-1/3" /></CardDescription>
  </CardHeader>;
}

function FactsSkeleton({ job }: CardSkeletonProps) {
  const count = job === undefined ? 6 : publicJobFacts(job).length;
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
    {Array.from({ length: count }, (_, key) => <div key={key} className="flex min-w-0 flex-col gap-1">
      <dt><Skeleton aria-hidden="true" className="h-4 w-24" /></dt>
      <dd><Skeleton aria-hidden="true" className="h-5 w-3/4" /></dd>
    </div>)}
  </dl>;
}

/** Skeleton exception: the same native slots, columns, identity/chip rhythm and rail as the list card. */
export function PublicJobCardSkeleton({ job, excerpt, skills = [], benefits = [], quickApply }: CardSkeletonProps = {}) {
  const salary = job === undefined || formatPublicSalary(job) !== null;
  const chipsCount = job === undefined ? 4 : publicJobChips(job).length;
  const hasExtras = Boolean(excerpt?.trim() || skills.length || benefits.length);
  return <Card aria-hidden="true" className={PUBLIC_VACANCY_CARD}>
    <CardHeader className={PUBLIC_VACANCY_HEADER}>
      <CardTitle className={PUBLIC_VACANCY_TITLE}><Skeleton aria-hidden="true" className="size-12 shrink-0 rounded-full" /><Skeleton aria-hidden="true" className="h-10 w-3/4" /></CardTitle>
      <CardDescription className={PUBLIC_VACANCY_DESCRIPTION}>
        <Skeleton aria-hidden="true" className="h-5 w-28 max-w-full" />
        <div className={PUBLIC_VACANCY_META}>
          {(job === undefined || job.location) && <Skeleton aria-hidden="true" className="h-4 w-32 max-w-full" />}
          <Skeleton aria-hidden="true" className="h-4 w-24 max-w-full" />
        </div>
      </CardDescription>
      <CardAction />
    </CardHeader>
    <CardContent className={PUBLIC_VACANCY_CONTENT}>
      <div data-public-job-chips className={PUBLIC_VACANCY_CHIPS}>{Array.from({ length: chipsCount }, (_, key) => <Skeleton key={key} aria-hidden="true" className="h-5 w-24" />)}</div>
      {hasExtras && <>
        <Separator />
        {excerpt?.trim() && <Skeleton aria-hidden="true" className="h-10 w-full max-w-prose" />}
        {(skills.length > 0 || benefits.length > 0) && <dl className="grid gap-4 sm:grid-cols-2">
          {skills.length > 0 && <div className="flex min-w-0 flex-col gap-2"><dt><Skeleton aria-hidden="true" className="h-4 w-24" /></dt><dd className="flex flex-wrap gap-1.5">{skills.map((_, key) => <Skeleton key={key} aria-hidden="true" className="h-5 w-16" />)}</dd></div>}
          {benefits.length > 0 && <div className="flex min-w-0 flex-col gap-2"><dt><Skeleton aria-hidden="true" className="h-4 w-24" /></dt><dd><Skeleton aria-hidden="true" className="h-10 w-full" /></dd></div>}
        </dl>}
      </>}
    </CardContent>
    <CardFooter className={PUBLIC_VACANCY_RAIL}>
      <div className="flex min-w-0 flex-col gap-2"><Skeleton aria-hidden="true" className="h-4 w-28 max-w-full" /><Skeleton aria-hidden="true" className={salary ? "h-14 w-full" : "h-5 w-36 max-w-full"} /></div>
      <Skeleton aria-hidden="true" className="h-10 w-full" />
      {quickApply === true && <Skeleton aria-hidden="true" className="h-4 w-32 max-w-full self-center" />}
    </CardFooter>
  </Card>;
}

/** Skeleton exception: mirror the detail, not the list card (no identity CTA). */
export function PublicJobDetailSkeleton({ job }: { job?: PublicJobDetail } = {}) {
  const salary = job === undefined || formatPublicSalary(job) !== null;
  const requirements = job === undefined || (job.source === "vacancy" && (job.requirements.required || job.requirements.preferred));
  const benefitCount = job === undefined ? 2 : job.source === "vacancy" ? job.benefits.predefined.length + job.benefits.custom.length : 0;
  return <section aria-busy="true" aria-label="Detalle de vacante" className="flex flex-col gap-6">
    <span role="status" className="sr-only">Cargando vacante</span>
    <div aria-hidden="true" className="flex flex-col gap-6">
      <nav><Skeleton aria-hidden="true" className="h-10 w-28" /></nav>
      <Card>
        <IdentitySkeleton detail />
        <CardContent><FactsSkeleton job={job} /></CardContent>
        <CardFooter className="border-t"><Skeleton aria-hidden="true" className="h-5 w-64 max-w-full" /></CardFooter>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader className="border-b"><CardTitle><Skeleton aria-hidden="true" className="h-7 w-48" /></CardTitle></CardHeader>
            <CardContent className="max-w-prose"><div className="flex flex-col gap-4 text-sm leading-relaxed">
              {Array.from({ length: job?.description_plain.split(/\n\s*\n/u).length ?? 3 }, (_, key) => <Skeleton key={key} aria-hidden="true" className="h-5 w-full" />)}
            </div></CardContent>
          </Card>
          {requirements && <Card>
            <CardHeader className="border-b"><CardTitle><Skeleton aria-hidden="true" className="h-7 w-40" /></CardTitle></CardHeader>
            <CardContent><dl className="flex max-w-prose flex-col gap-4">
              {(job === undefined ? [true, true] : [job.requirements.required, job.requirements.preferred]).map((present, key) => present && <div key={key} className="flex flex-col gap-1"><dt><Skeleton aria-hidden="true" className="h-4 w-28" /></dt><dd><Skeleton aria-hidden="true" className="h-5 w-full" /></dd></div>)}
            </dl></CardContent>
          </Card>}
          {benefitCount > 0 && <Card>
            <CardHeader className="border-b"><CardTitle><Skeleton aria-hidden="true" className="h-7 w-40" /></CardTitle></CardHeader>
            <CardContent><ul className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: benefitCount }, (_, key) => <li key={key} className="min-w-0"><Item variant="outline" size="sm"><ItemMedia variant="icon"><Skeleton aria-hidden="true" className="size-4" /></ItemMedia><ItemContent className="min-w-0"><Skeleton aria-hidden="true" className="h-5 w-full" /></ItemContent></Item></li>)}
            </ul></CardContent>
          </Card>}
        </div>
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          {salary && <Card>
            <CardHeader><CardTitle><Skeleton aria-hidden="true" className="h-7 w-40" /></CardTitle></CardHeader>
            <CardContent><Skeleton aria-hidden="true" className="h-7 w-full" /></CardContent>
          </Card>}
          <Card>
            <CardHeader><CardTitle><Skeleton aria-hidden="true" className="h-7 w-32" /></CardTitle></CardHeader>
            <CardFooter><Skeleton aria-hidden="true" className="h-10 w-full" /></CardFooter>
          </Card>
        </aside>
      </div>
    </div>
  </section>;
}
