import { previewSalaryParts } from "../create/form/preview-salary";
import type { PrototypeJobView } from "../enrich";

/** Legacy jobs have no contractual cadence or net/gross basis. Do not use demo enrichment. */
export function ApplicationSalary({ job }: { job: PrototypeJobView }) {
  const salary = previewSalaryParts({ source: "legacy", legacy_salary: job.salary_min === undefined && job.salary_max === undefined ? null : {
    min: job.salary_min === undefined ? null : String(job.salary_min),
    max: job.salary_max === undefined ? null : String(job.salary_max),
    currency: job.salary_currency,
  } });
  return <div className="flex min-w-0 flex-col gap-1">
    <p className="text-lg font-semibold tabular-nums break-words">{salary ? `${salary.amount} ${salary.currency}` : "Salario no publicado"}</p>
    {salary && <p className="text-sm text-muted-foreground">Periodicidad y neto/bruto no publicados</p>}
  </div>;
}
