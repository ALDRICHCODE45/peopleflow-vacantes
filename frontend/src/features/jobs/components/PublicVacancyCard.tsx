import Link from "next/link";
import { ArrowRightIcon, GiftIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatPublicSalary } from "../formatters";
import { benefitLabel } from "../drafts/ui/draft-labels";
import { PublicScreeningInfo } from "./public-application-info";
import type { PublicJobItem } from "../types";
import { PublicVacancyHeader } from "./PublicVacancyHeader";
import { publicJobChips } from "./public-job-facts";
import { PUBLIC_VACANCY_CARD, PUBLIC_VACANCY_CHIPS, PUBLIC_VACANCY_CONTENT, PUBLIC_VACANCY_RAIL } from "./public-vacancy-layout";

export type PublicVacancyCardProps = { job: PublicJobItem };

/** One two-zone composition for both sources, using only the validated public projection. */
export function PublicVacancyCard({ job }: PublicVacancyCardProps) {
  const salary = formatPublicSalary(job);
  const benefits = [...job.benefits_preview.predefined.map(benefitLabel), ...job.benefits_preview.custom];
  if (job.benefits_total > 3) benefits.push(`+${job.benefits_total - 3}`);
  const skills = job.skills_preview;
  return <li className="min-w-0">
    <Card className={PUBLIC_VACANCY_CARD}>
      <PublicVacancyHeader job={job} />
      <CardContent className={PUBLIC_VACANCY_CONTENT}>
        <div data-public-job-chips className={PUBLIC_VACANCY_CHIPS}>
          {publicJobChips(job).map(({ key, label, value, Icon }) => <Badge key={key} variant="outline" data-fact={key} aria-label={`${label}: ${value}`}><Icon aria-hidden="true" />{value}</Badge>)}
        </div>
        {job.excerpt !== null && <p className="line-clamp-2 max-w-prose text-sm leading-relaxed text-muted-foreground">{job.excerpt}{job.excerpt_truncated ? "…" : ""}</p>}
        {(skills.length > 0 || benefits.length > 0) && <>
          <Separator />
          <dl className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {skills.length > 0 && <div className="flex min-w-0 flex-col gap-2">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Habilidades</dt>
              <dd className="flex flex-wrap gap-1.5">{skills.map((skill, index) => <Badge key={index} variant="secondary" className="h-auto max-w-full whitespace-normal break-words">{skill}</Badge>)}{job.skills_total > 6 && <Badge variant="secondary">+{job.skills_total - 6}</Badge>}</dd>
            </div>}
            {benefits.length > 0 && <div className="flex min-w-0 flex-col gap-2">
              <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"><GiftIcon aria-hidden="true" className="size-3.5" />Beneficios</dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{benefits.join(" · ")}</dd>
            </div>}
          </dl>
        </>}
      </CardContent>
      <CardFooter className={PUBLIC_VACANCY_RAIL}>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{job.source === "vacancy" ? "Compensación" : "Salario"}</p>
          {salary === null
            ? <p className="text-sm text-muted-foreground">Salario no publicado</p>
            : <p data-public-salary className="font-heading text-xl font-semibold break-words tabular-nums">{salary}</p>}
        </div>
        <Link href={`/vacantes/${job.id}`} className={cn(buttonVariants(), "min-h-10 w-full")}>Ver vacante<ArrowRightIcon aria-hidden="true" data-icon="inline-end" /></Link>
        <PublicScreeningInfo count={job.screening_questions} />
      </CardFooter>
    </Card>
  </li>;
}
