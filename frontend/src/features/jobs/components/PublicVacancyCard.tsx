import Link from "next/link";
import { ArrowRightIcon, GiftIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { benefitLabel } from "../drafts/ui/draft-labels";
import { PublicApplicants, PublicScreeningInfo } from "./public-application-info";
import type { PublicJobItem } from "../types";
import { PublicVacancyHeader } from "./PublicVacancyHeader";
import { publicJobConditions, publicJobSecondaryFacts } from "./public-job-facts";
import { PublicSalary } from "./public-salary";
import { PUBLIC_VACANCY_CARD, PUBLIC_VACANCY_CHIPS, PUBLIC_VACANCY_CONTENT, PUBLIC_VACANCY_CTA, PUBLIC_VACANCY_RAIL } from "./public-vacancy-layout";

export type PublicVacancyCardProps = { job: PublicJobItem };

/** Reference listing composition, using only the validated public projection. */
export function PublicVacancyCard({ job }: PublicVacancyCardProps) {
  const benefits = [...job.benefits_preview.predefined.map(benefitLabel), ...job.benefits_preview.custom];
  const moreBenefits = job.benefits_total - benefits.length;
  const secondary = publicJobSecondaryFacts(job);
  return <li className="min-w-0">
    <Card className={PUBLIC_VACANCY_CARD}>
      <PublicVacancyHeader job={job} />
      <CardContent className={PUBLIC_VACANCY_CONTENT}>
        <ul aria-label="Condiciones principales" data-public-job-chips className={PUBLIC_VACANCY_CHIPS}>
          {publicJobConditions(job).map(({ key, value, title, Icon }) => <li key={key} title={title} aria-label={title} data-fact={key} className="flex min-w-0 items-center gap-2"><Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />{value}</li>)}
          {job.applicants !== null && <li><PublicApplicants applicants={job.applicants} /></li>}
        </ul>
        {job.excerpt !== null && <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{job.excerpt}{job.excerpt_truncated ? "…" : ""}</p>}
        {secondary.length > 0 && <p data-public-secondary-facts className="text-sm text-muted-foreground">{secondary.map(fact => fact.value).join(" · ")}</p>}
        {job.skills_preview.length > 0 && <div aria-label="Habilidades" className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-muted-foreground">Habilidades</span>
          {job.skills_preview.map((skill, index) => <Badge key={index} variant="secondary" className="h-auto max-w-full whitespace-normal break-words">{skill}</Badge>)}
          {job.skills_total > 6 && <Badge variant="secondary">+{job.skills_total - 6}</Badge>}
        </div>}
        {benefits.length > 0 && <p aria-label="Beneficios" className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
          <GiftIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{benefits.join(" · ")}{moreBenefits > 0 && <> <Link href={`/vacantes/${job.id}#beneficios`} className="pf-public-accent rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">y {moreBenefits} beneficios más</Link></>}</span>
        </p>}
      </CardContent>
      <CardFooter className={PUBLIC_VACANCY_RAIL}>
        <PublicSalary job={job} />
        <div className={PUBLIC_VACANCY_CTA}>
          <Link href={`/vacantes/${job.id}`} className={cn(buttonVariants(), "min-h-11 px-5")}>Ver vacante<ArrowRightIcon aria-hidden="true" data-icon="inline-end" /></Link>
          <PublicScreeningInfo count={job.screening_questions} />
        </div>
      </CardFooter>
    </Card>
  </li>;
}
