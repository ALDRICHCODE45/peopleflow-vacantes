import * as React from "react";
/**
 * Server-rendered content of the public application route: the `Postularme`
 * identity header. The app header owns return navigation. This stays a server
 * component: it owns no client directive, hook, request, storage, form, timer,
 * or randomness, and it renders only the values the caller already validated.
 *
 * The two-column body lives in the client wizard, which owns the desktop rail
 * and slots the static `VacancyApplicationSummary` beside its own candidate
 * card; this shell never grows a form, a rail, or a fetch of its own.
 */
type VacancyApplicationShellProps = {
  job: { id: string; title: string; company: { name: string } };
  /** Application body owned by the caller; it already carries the responsive grid. */
  children?: React.ReactNode;
};

export function VacancyApplicationShell({
  job,
  children,
}: VacancyApplicationShellProps) {
  return (
    <div className="flex w-full flex-col gap-6">
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
