import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon, BanknoteIcon, MapPinIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { companyInitials } from "../components/prototype-ui";
import type { PrototypeJobView } from "../enrich";
import {
  employmentTypeLabel,
  formatSalary,
  seniorityLabel,
  workModeLabel,
} from "../formatters";

/**
 * Server-rendered shell of the public application route: the breadcrumb back to
 * the exact vacancy, the `Postularme` identity header, one content column for
 * the application body, and the desktop vacancy summary rail. It stays a server
 * component: it owns no client directive, hook, request, storage, form, timer,
 * or randomness, and it renders only the values the caller already validated.
 * The `children` it forwards are the application body, so this shell never
 * grows its own form.
 */
type VacancyApplicationShellProps = {
  job: PrototypeJobView;
  /** Application body owned by the caller; the host region wraps it. */
  children?: React.ReactNode;
};

/** One content column with the rail beside it from `lg` up, never below. */
const responsiveGrid = "grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]";

/**
 * Desktop-only summary rail: sticky inside its grid area at `lg` and up, plain
 * flow below it. No base `sticky`, so the narrow layout keeps normal scrolling.
 */
const stickyRail = "flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start";

/** Shared shape of one term/value row in the summary rail. */
const metaRow = "flex items-start justify-between gap-3";
const metaTerm = "flex items-center gap-2 text-xs text-muted-foreground";
const metaValue = "text-right font-medium break-words text-foreground";

export function VacancyApplicationShell({
  job,
  children,
}: VacancyApplicationShellProps) {
  // The salary line exists only when the wire vacancy carries an amount; the
  // shared formatter stays the single source for its presentation.
  const salary =
    job.salary_min !== undefined || job.salary_max !== undefined
      ? formatSalary({
          min: job.salary_min,
          max: job.salary_max,
          currency: job.salary_currency,
        })
      : null;

  return (
    <div className="flex w-full flex-col gap-6">
      <nav aria-label="Ruta de navegación" className="text-sm text-muted-foreground">
        <Link
          href={`/vacantes/${job.id}`}
          className={buttonVariants({
            variant: "outline",
            size: "lg",
            className: "min-h-11 gap-1.5",
          })}
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0" />
          Volver a la vacante
        </Link>
      </nav>

      <header data-pf-application-header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Postularme
        </h1>
        <p className="font-heading text-lg font-semibold text-foreground">
          {job.title}
        </p>
        <p className="text-sm text-muted-foreground">{job.company.name}</p>
      </header>

      <div className={responsiveGrid}>
        <div
          data-pf-application-form-host
          className="flex min-w-0 flex-col gap-6"
        >
          {children}
        </div>

        <aside className={stickyRail}>
          <Card>
            <CardHeader>
              <h2 className="font-heading text-base font-medium text-foreground">
                Resumen de la vacante
              </h2>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  <AvatarFallback>{companyInitials(job.company.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-heading text-sm font-semibold text-foreground">
                    {job.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {job.company.name}
                  </p>
                </div>
              </div>

              <ul className="flex flex-wrap gap-2">
                <li><Badge variant="secondary">{workModeLabel(job.work_mode)}</Badge></li>
                <li><Badge variant="secondary">{employmentTypeLabel(job.employment_type)}</Badge></li>
                <li><Badge variant="secondary">{seniorityLabel(job.seniority)}</Badge></li>
              </ul>

              <Separator />

              <dl className="flex flex-col gap-3 text-sm">
                {salary !== null && (
                  <div className={metaRow}>
                    <dt className={metaTerm}>
                      <BanknoteIcon aria-hidden="true" className="size-4 shrink-0" />
                      Salario
                    </dt>
                    <dd className={metaValue}>{salary}</dd>
                  </div>
                )}
                {job.location !== undefined && (
                  <div className={metaRow}>
                    <dt className={metaTerm}>
                      <MapPinIcon aria-hidden="true" className="size-4 shrink-0" />
                      Ubicación
                    </dt>
                    <dd className={metaValue}>{job.location}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
