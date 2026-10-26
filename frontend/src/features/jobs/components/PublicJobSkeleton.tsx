import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPublicSalaryParts } from "../formatters";
import type { PublicJobItem } from "../types";
import { publicJobConditions, publicJobSecondaryFacts } from "./public-job-facts";
import { PUBLIC_VACANCY_CARD, PUBLIC_VACANCY_CHIPS, PUBLIC_VACANCY_CONTENT, PUBLIC_VACANCY_CTA, PUBLIC_VACANCY_DESCRIPTION, PUBLIC_VACANCY_HEADER, PUBLIC_VACANCY_RAIL, PUBLIC_VACANCY_TITLE } from "./public-vacancy-layout";

type CardSkeletonProps = { job?: PublicJobItem };
const blocks = (count: number) => Array.from({ length: count }, (_, key) => key);

function SalarySkeleton({ job }: CardSkeletonProps) {
  const salary = job === undefined ? undefined : formatPublicSalaryParts(job);
  if (salary === null) return <Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" />;
  return <div className="flex min-w-0 flex-col gap-1">
    <Skeleton aria-hidden="true" className="h-7 w-52 max-w-full" />
    {(salary === undefined || salary.cadence !== null) && <Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" />}
  </div>;
}

/** Same native slots and optional blocks as the listing, never an unrelated generic card. */
export function PublicJobCardSkeleton({ job }: CardSkeletonProps = {}) {
  const conditions = job === undefined ? 3 : publicJobConditions(job).length;
  const secondary = job === undefined || publicJobSecondaryFacts(job).length > 0;
  const skills = job === undefined ? 6 : job.skills_preview.length + (job.skills_total > 6 ? 1 : 0);
  const benefits = job === undefined || job.benefits_preview.predefined.length + job.benefits_preview.custom.length > 0;
  return <Card aria-hidden="true" className={PUBLIC_VACANCY_CARD}>
    <CardHeader className={PUBLIC_VACANCY_HEADER}>
      <div className="col-start-1 row-span-2 row-start-1"><Skeleton aria-hidden="true" className="size-12 rounded-xl" /></div>
      <CardTitle className={PUBLIC_VACANCY_TITLE}><Skeleton aria-hidden="true" className="h-7 w-3/4" /></CardTitle>
      <CardDescription className={PUBLIC_VACANCY_DESCRIPTION}><Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" /></CardDescription>
      <CardAction className="col-start-3"><Skeleton aria-hidden="true" className="h-5 w-12" /></CardAction>
    </CardHeader>
    <CardContent className={PUBLIC_VACANCY_CONTENT}>
      <ul data-public-job-chips className={PUBLIC_VACANCY_CHIPS}>
        {blocks(conditions).map(key => <li key={key}><Skeleton aria-hidden="true" className="h-5 w-32" /></li>)}
        {(job === undefined || job.applicants !== null) && <li><Skeleton aria-hidden="true" className="h-5 w-40" /></li>}
      </ul>
      {(job === undefined || job.excerpt !== null) && <Skeleton aria-hidden="true" data-skeleton-excerpt className="h-10 w-full" />}
      {secondary && <Skeleton aria-hidden="true" className="h-5 w-3/4" />}
      {skills > 0 && <div className="flex min-w-0 flex-wrap items-center gap-2"><Skeleton aria-hidden="true" className="h-5 w-24" />{blocks(skills).map(key => <Skeleton key={key} aria-hidden="true" className="h-5 w-16" />)}</div>}
      {benefits && <Skeleton aria-hidden="true" className="h-6 w-full" />}
    </CardContent>
    <CardFooter className={PUBLIC_VACANCY_RAIL}>
      <SalarySkeleton job={job} />
      <div className={PUBLIC_VACANCY_CTA}>
        <Skeleton aria-hidden="true" className="h-11 w-36 max-[480px]:w-full" />
        {(job === undefined || job.screening_questions !== null) && <Skeleton aria-hidden="true" className="h-5 w-40 max-w-full self-center" />}
      </div>
    </CardFooter>
  </Card>;
}
