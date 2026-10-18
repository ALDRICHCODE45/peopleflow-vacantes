"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClockIcon, MapPinIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatPublishedDate, formatRelativePublishedDate, isNewPublication } from "../formatters";
import type { PublicJobItem } from "../types";
import { PublicCompanyAvatar } from "./PublicCompanyAvatar";
import { PublicApplicants } from "./public-application-info";
import { PUBLIC_VACANCY_DESCRIPTION, PUBLIC_VACANCY_HEADER, PUBLIC_VACANCY_META, PUBLIC_VACANCY_TITLE } from "./public-vacancy-layout";

/** Absolute SSR/first hydration render; one clock owns both time and Nueva after mount. */
export function PublicVacancyHeader({ job }: { job: PublicJobItem }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const current = Date.now();
      setNow(current);
      const age = current - Date.parse(job.published_at);
      // Align ticks to the publication minute, including the exact 48-hour expiry.
      timer = setTimeout(update, age < 0 ? Math.min(60_000, -age) : 60_000 - age % 60_000);
    };
    update();
    return () => clearTimeout(timer);
  }, [job.published_at]);
  const absolute = formatPublishedDate(job.published_at);
  return <CardHeader className={PUBLIC_VACANCY_HEADER}>
    <CardTitle className={PUBLIC_VACANCY_TITLE}>
      <PublicCompanyAvatar company={job.company} />
      <h3 className="min-w-0 font-heading text-lg font-semibold break-words"><Link href={`/vacantes/${job.id}`} className="inline-flex min-h-10 items-center rounded-md hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{job.title}</Link></h3>
    </CardTitle>
    <CardDescription className={PUBLIC_VACANCY_DESCRIPTION}>
      <p className="break-words">{job.company.name}</p>
      <div className={PUBLIC_VACANCY_META}>
        {job.location && <><span className="inline-flex min-w-0 items-center gap-1.5"><MapPinIcon aria-hidden="true" className="size-3.5 shrink-0" />{job.location}</span><span aria-hidden="true">·</span></>}
        <TooltipProvider><Tooltip>
          <TooltipTrigger render={<span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />}>
            <ClockIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <time dateTime={job.published_at}>{now === null ? absolute : formatRelativePublishedDate(job.published_at, now)}</time>
          </TooltipTrigger>
          <TooltipContent>Publicada el {absolute}</TooltipContent>
        </Tooltip></TooltipProvider>
        {job.applicants !== null && <><span aria-hidden="true">·</span><PublicApplicants applicants={job.applicants} /></>}
      </div>
    </CardDescription>
    <CardAction>{now !== null && isNewPublication(job.published_at, now) && <Badge variant="accent">Nueva</Badge>}</CardAction>
  </CardHeader>;
}
