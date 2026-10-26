import { Fragment } from "react";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatPublicSalaryParts } from "../formatters";
import type { PublicJobDetail, PublicJobItem } from "../types";
import type { DraftRichBlockNode } from "../drafts/rich/grammar";
import { publicJobConditions, publicJobFacts, publicJobHeroFacts, publicJobSecondaryFacts } from "./public-job-facts";
import { publicDetailBenefits, publicDetailSections } from "./public-detail-content";
import { PUBLIC_ACTION_CARD, PUBLIC_COMPANY_FOOTER, PUBLIC_DETAIL_ASIDE, PUBLIC_DETAIL_BENEFITS, PUBLIC_DETAIL_BODY, PUBLIC_DETAIL_CARD, PUBLIC_DETAIL_FACTS, PUBLIC_DETAIL_GRID, PUBLIC_DETAIL_HEADER, PUBLIC_DETAIL_HERO, PUBLIC_DETAIL_SECTION, PUBLIC_VACANCY_CARD, PUBLIC_VACANCY_CHIPS, PUBLIC_VACANCY_CONTENT, PUBLIC_VACANCY_CTA, PUBLIC_VACANCY_DESCRIPTION, PUBLIC_VACANCY_HEADER, PUBLIC_VACANCY_RAIL, PUBLIC_VACANCY_TITLE } from "./public-vacancy-layout";

type CardSkeletonProps = { job?: PublicJobItem };
const blocks = (count: number) => Array.from({ length: count }, (_, key) => key);

/** Match authored paragraph/list nesting and ordered starts, without exposing text. */
function RichBlockSkeleton({ block }: { block: DraftRichBlockNode }) {
  if (block.type === "paragraph") return <Skeleton aria-hidden="true" className="h-6 w-full" />;
  const items = block.content.map((item, key) => <li key={key}>{item.content.map((child, index) => <RichBlockSkeleton key={index} block={child} />)}</li>);
  return block.type === "bulletList"
    ? <ul className="list-disc flex flex-col gap-1 pl-6">{items}</ul>
    : <ol start={block.attrs.start} className="list-decimal flex flex-col gap-1 pl-6">{items}</ol>;
}

function DescriptionSkeleton({ job }: { job?: PublicJobDetail }) {
  return <div className="pf-job-description max-w-prose break-words"><div className="flex flex-col gap-5">
    {job?.source === "vacancy" && job.description !== null
      ? job.description.document.content.map((block, key) => <RichBlockSkeleton key={key} block={block} />)
      : blocks(job?.description_plain.split(/\n\s*\n/u).length ?? 3).map(key => <Skeleton key={key} aria-hidden="true" className="h-6 w-full" />)}
  </div></div>;
}

function SalarySkeleton({ job, detail = false }: CardSkeletonProps & { detail?: boolean }) {
  const salary = job === undefined ? undefined : formatPublicSalaryParts(job);
  if (salary === null) return <Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" />;
  return <div className="flex min-w-0 flex-col gap-1">
    <Skeleton aria-hidden="true" className={detail ? "h-10 w-full" : "h-7 w-52 max-w-full"} />
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

/** Skeleton exception: mirror hero, glance, anchored content and a single sticky actions card. */
export function PublicJobDetailSkeleton({ job }: { job?: PublicJobDetail } = {}) {
  const sections = publicDetailSections(job);
  return <section aria-busy="true" aria-label="Detalle de vacante" className="flex w-full flex-col gap-6">
    <span role="status" className="sr-only">Cargando vacante</span>
    <div aria-hidden="true" className="flex w-full flex-col gap-6">
      <Card className={PUBLIC_DETAIL_HERO}>
        <CardHeader className={PUBLIC_DETAIL_HEADER}>
          <div className="col-start-1 row-span-3 row-start-1"><Skeleton aria-hidden="true" className="size-16 rounded-2xl" /></div>
          <CardDescription className="col-start-2 row-start-1"><Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" /></CardDescription>
          <CardTitle className="col-start-2 row-start-2 min-w-0"><Skeleton aria-hidden="true" className="h-8 w-3/4 sm:h-10" /></CardTitle>
          <div className="col-start-2 row-start-3 flex min-w-0 flex-wrap gap-2">{blocks(job === undefined ? 3 : publicJobHeroFacts(job).length).map(key => <Skeleton key={key} aria-hidden="true" className="h-5 w-24" />)}</div>
        </CardHeader>
        <CardContent><Skeleton aria-hidden="true" className="h-5 w-64 max-w-full" /></CardContent>
      </Card>
      <div className={PUBLIC_DETAIL_GRID}>
        <div className="flex min-w-0 flex-col gap-6">
          <Card className={PUBLIC_DETAIL_CARD}>
            <CardHeader><CardTitle><Skeleton aria-hidden="true" className="h-7 w-56 max-w-full" /></CardTitle></CardHeader>
            <CardContent><dl className={PUBLIC_DETAIL_FACTS}>{blocks(job === undefined ? 6 : publicJobFacts(job).length).map(key => <div key={key} className="flex min-w-0 flex-col gap-2"><dt><Skeleton aria-hidden="true" className="h-5 w-24 max-w-full" /></dt><dd><Skeleton aria-hidden="true" className="h-5 w-3/4" /></dd></div>)}</dl></CardContent>
          </Card>
          {sections.length > 0 && <Card className={PUBLIC_DETAIL_CARD}>
            <CardHeader><nav className="pf-job-section-nav">{sections.map(section => <Skeleton key={section.id} aria-hidden="true" className="mb-4 h-6 w-20 shrink-0" />)}</nav></CardHeader>
            <CardContent className={PUBLIC_DETAIL_BODY}>{sections.map(({ id }, index) => <Fragment key={id}>
              {index > 0 && <Separator />}
              <section className={PUBLIC_DETAIL_SECTION}>
                <Skeleton aria-hidden="true" className="h-7 w-48 max-w-full" />
                {id === "descripcion" && <DescriptionSkeleton job={job} />}
                {id === "requisitos" && <>
                  <Skeleton aria-hidden="true" className="h-6 w-3/4" />
                  {(job === undefined ? [true, true] : [job.requirements.required?.trim(), job.requirements.preferred?.trim()]).map((present, key) => present && <div key={key} className="flex max-w-prose flex-col gap-4"><Skeleton aria-hidden="true" className="h-6 w-48 max-w-full" /><Skeleton aria-hidden="true" className="h-12 w-full" /></div>)}
                </>}
                {id === "habilidades" && <ul className="flex flex-wrap gap-2">{blocks(job?.skills.length ?? 6).map(key => <li key={key}><Skeleton aria-hidden="true" className="h-5 w-16" /></li>)}</ul>}
                {id === "beneficios" && <>
                  <Skeleton aria-hidden="true" className="h-6 w-3/4" />
                  <ul className={PUBLIC_DETAIL_BENEFITS}>{blocks(job === undefined ? 8 : publicDetailBenefits(job).length).map(key => <li key={key} className="flex min-w-0 items-center gap-3"><Skeleton aria-hidden="true" className="size-10 shrink-0 rounded-xl" /><Skeleton aria-hidden="true" className="h-5 w-3/4" /></li>)}</ul>
                </>}
              </section>
            </Fragment>)}</CardContent>
          </Card>}
        </div>
        <aside className={PUBLIC_DETAIL_ASIDE}>
          <Card className={PUBLIC_ACTION_CARD}>
            <CardHeader><CardTitle><Skeleton aria-hidden="true" className="h-5 w-32" /></CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-6">
              <SalarySkeleton job={job} detail />
              <Separator />
              <div className="flex flex-col gap-3"><Skeleton aria-hidden="true" className="h-5 w-48 max-w-full" /><Skeleton aria-hidden="true" className="h-10 w-full" /></div>
              <div className="flex flex-col gap-2">
                <Skeleton aria-hidden="true" className="h-12 w-full" />
                <div className="flex flex-col gap-1"><Skeleton aria-hidden="true" className="h-11 w-full" /><Skeleton aria-hidden="true" className="h-5 w-full" /></div>
                {(job === undefined || job.applicants !== null) && <Skeleton aria-hidden="true" className="h-5 w-40 max-w-full" />}
                {(job === undefined || job.screening_questions !== null) && <Skeleton aria-hidden="true" className="h-5 w-40 max-w-full self-center" />}
              </div>
            </CardContent>
            <CardFooter className={PUBLIC_COMPANY_FOOTER}><Skeleton aria-hidden="true" className="size-5 shrink-0" /><div className="flex min-w-0 flex-col gap-1"><Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" /><Skeleton aria-hidden="true" className="h-5 w-44 max-w-full" /></div></CardFooter>
          </Card>
        </aside>
      </div>
    </div>
  </section>;
}
