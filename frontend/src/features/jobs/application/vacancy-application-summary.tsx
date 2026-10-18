import { BanknoteIcon, MapPinIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ApplicationSalary } from "./application-salary";

import { companyInitials } from "../components/prototype-ui";
import type { PrototypeJobView } from "../enrich";
import {
  employmentTypeLabel,
  seniorityLabel,
  workModeLabel,
} from "../formatters";

/**
 * Server-rendered vacancy summary card. It stays a server component — no client
 * directive, hook, request, storage, form, timer, or randomness — and renders
 * only the values the caller already validated, so the public application route
 * can slot it into the client wizard rail without shipping it twice.
 */
type VacancyApplicationSummaryProps = {
  job: PrototypeJobView;
};

/** Shared shape of one term/value row in the summary rail. */
const metaRow = "flex items-start justify-between gap-3";
const metaTerm = "flex items-center gap-2 text-xs text-muted-foreground";
const metaValue = "text-right font-medium break-words text-foreground";

export function VacancyApplicationSummary({ job }: VacancyApplicationSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Resumen de la vacante</h2></CardTitle>
        <CardDescription>{job.company.name}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar size="lg">
            <AvatarFallback>{companyInitials(job.company.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-heading text-sm font-semibold break-words text-foreground">
              {job.title}
            </p>

          </div>
        </div>

        <ul className="flex flex-wrap gap-2">
          <li><Badge variant="secondary">{workModeLabel(job.work_mode)}</Badge></li>
          <li className="text-sm text-muted-foreground">{employmentTypeLabel(job.employment_type)} · {seniorityLabel(job.seniority)}</li>
        </ul>

        <Separator />

        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-2">
            <dt className={metaTerm}><BanknoteIcon aria-hidden="true" className="size-4 shrink-0" />Salario</dt>
            <dd><ApplicationSalary job={job} /></dd>
          </div>
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
  );
}
