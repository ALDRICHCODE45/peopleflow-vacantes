import Link from "next/link";
import { ArrowRightIcon, BanknoteIcon, Building2Icon, CalendarClockIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPublicSalary, formatPublishedDate } from "../formatters";
import type { PublicJobItem } from "../types";
import { PublicJobFacts } from "./public-job-facts";

/** One composition for both public sources; only contract-backed facts appear. */
export function PublicVacancyCard({ job }: { job: PublicJobItem }) {
  const salary = formatPublicSalary(job);
  return <li>
    <Card>
      <CardHeader className="border-b">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar size="lg" aria-hidden="true"><AvatarFallback><Building2Icon aria-hidden="true" className="size-5" /></AvatarFallback></Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle><h3 className="font-heading text-lg font-semibold break-words"><Link href={`/vacantes/${job.id}`} className="inline-flex min-h-10 items-center rounded-md hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{job.title}</Link></h3></CardTitle>
            <CardDescription>{job.company.name}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PublicJobFacts job={job} />
        {salary !== null && <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><BanknoteIcon aria-hidden="true" className="size-3.5" />{job.source === "vacancy" ? "Compensación" : "Salario"}</span>
          <p className="font-heading font-semibold break-words">{salary}</p>
        </div>}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-3 border-t">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClockIcon aria-hidden="true" className="size-3.5 shrink-0" /><time dateTime={job.published_at}>Publicada el {formatPublishedDate(job.published_at)}</time></span>
        <Link href={`/vacantes/${job.id}`} className={cn(buttonVariants({ variant: "outline" }), "min-h-10")}>Ver vacante<ArrowRightIcon aria-hidden="true" data-icon="inline-end" /></Link>
      </CardFooter>
    </Card>
  </li>;
}
