import Link from "next/link";
import { ArrowRightIcon, GiftIcon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatPublicSalary } from "../formatters";
import type { PublicJobItem } from "../types";
import { PublicVacancyHeader } from "./PublicVacancyHeader";
import { publicJobChips } from "./public-job-facts";
import { PUBLIC_VACANCY_CARD, PUBLIC_VACANCY_CHIPS, PUBLIC_VACANCY_CONTENT, PUBLIC_VACANCY_RAIL, type PublicVacancyCardExtras } from "./public-vacancy-layout";

export type PublicVacancyCardProps = { job: PublicJobItem } & PublicVacancyCardExtras;

/** One two-zone composition for both public sources; absent future data leaves no empty section. */
export function PublicVacancyCard({ job, excerpt, benefits = [], skills = [], quickApply }: PublicVacancyCardProps) {
  const salary = formatPublicSalary(job);
  const hasExtras = Boolean(excerpt?.trim() || skills.length || benefits.length);
  return <li className="min-w-0">
    <Card className={PUBLIC_VACANCY_CARD}>
      <PublicVacancyHeader job={job} />
      <CardContent className={PUBLIC_VACANCY_CONTENT}>
        <div data-public-job-chips className={PUBLIC_VACANCY_CHIPS}>
          {publicJobChips(job).map(({ key, label, value, Icon }) => <Badge key={key} variant="outline" data-fact={key} aria-label={`${label}: ${value}`}><Icon aria-hidden="true" />{value}</Badge>)}
        </div>
        {hasExtras && <>
          <Separator />
          {excerpt?.trim() && <p className="line-clamp-2 max-w-prose text-sm leading-relaxed text-muted-foreground">{excerpt}</p>}
          {(skills.length > 0 || benefits.length > 0) && <dl className="grid gap-4 sm:grid-cols-2">
            {skills.length > 0 && <div className="flex min-w-0 flex-col gap-2">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Habilidades</dt>
              <dd className="flex flex-wrap gap-1.5">{skills.map(skill => <Badge key={skill} variant="secondary">{skill}</Badge>)}</dd>
            </div>}
            {benefits.length > 0 && <div className="flex min-w-0 flex-col gap-2">
              <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"><GiftIcon aria-hidden="true" className="size-3.5" />Beneficios</dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{benefits.join(" · ")}</dd>
            </div>}
          </dl>}
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
        {quickApply === true && <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><ZapIcon aria-hidden="true" className="size-3.5" />Postulación rápida</p>}
      </CardFooter>
    </Card>
  </li>;
}
