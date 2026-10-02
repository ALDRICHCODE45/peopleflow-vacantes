import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

import type { PrototypeJobView } from "../enrich";

/**
 * Server-rendered shell of the public application route: the breadcrumb back to
 * the exact vacancy and the `Postularme` identity header. It stays a server
 * component: it owns no client directive, hook, request, storage, form, timer,
 * or randomness, and it renders only the values the caller already validated.
 *
 * The two-column body lives in the client wizard, which owns the desktop rail
 * and slots the static `VacancyApplicationSummary` beside its own candidate
 * card; this shell never grows a form, a rail, or a fetch of its own.
 */
type VacancyApplicationShellProps = {
  job: PrototypeJobView;
  /** Application body owned by the caller; it already carries the responsive grid. */
  children?: React.ReactNode;
};

export function VacancyApplicationShell({
  job,
  children,
}: VacancyApplicationShellProps) {
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

      {children}
    </div>
  );
}
