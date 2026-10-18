"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isNewPublication } from "../formatters";
import type { PublicJobItem } from "../types";
import { PublicCompanyAvatar } from "./PublicCompanyAvatar";
import { PUBLIC_VACANCY_DESCRIPTION, PUBLIC_VACANCY_HEADER, PUBLIC_VACANCY_TITLE } from "./public-vacancy-layout";

/** Hydration-safe freshness badge, expiring at the existing 48-hour boundary. */
export function PublicVacancyHeader({ job }: { job: PublicJobItem }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const current = Date.now();
      setNow(current);
      const age = current - Date.parse(job.published_at);
      timer = setTimeout(update, age < 0 ? Math.min(60_000, -age) : 60_000 - age % 60_000);
    };
    update();
    return () => clearTimeout(timer);
  }, [job.published_at]);
  return <CardHeader className={PUBLIC_VACANCY_HEADER}>
    <div className="col-start-1 row-span-2 row-start-1"><PublicCompanyAvatar company={job.company} /></div>
    <CardTitle className={PUBLIC_VACANCY_TITLE}>
      <h3 className="min-w-0 font-heading text-xl font-semibold tracking-tight break-words"><Link href={`/vacantes/${job.id}`} className="pf-public-title rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{job.title}</Link></h3>
    </CardTitle>
    <CardDescription className={PUBLIC_VACANCY_DESCRIPTION}>{job.company.name}</CardDescription>
    <CardAction className="col-start-3">{now !== null && isNewPublication(job.published_at, now) && <Badge variant="secondary">Nueva</Badge>}</CardAction>
  </CardHeader>;
}
