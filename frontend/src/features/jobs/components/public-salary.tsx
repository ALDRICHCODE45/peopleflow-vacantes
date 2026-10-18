import { cn } from "@/lib/utils";
import { formatPublicSalaryParts } from "../formatters";
import type { PublicJobItem } from "../types";

export function PublicSalary({ job, detail = false }: { job: PublicJobItem; detail?: boolean }) {
  const salary = formatPublicSalaryParts(job);
  if (salary === null) return <p className="text-sm text-muted-foreground">Salario no publicado</p>;
  return <div className="flex min-w-0 flex-col gap-1">
    <p data-public-salary className="flex flex-wrap items-baseline gap-x-1.5">
      <span className={cn("font-heading font-semibold tracking-tight break-words tabular-nums", detail ? "text-4xl" : "text-xl")}>{salary.amount}</span>{" "}
      <span className="text-sm font-medium text-muted-foreground">{salary.currency}</span>
    </p>
    {salary.cadence !== null && <p className="text-sm text-muted-foreground">{salary.cadence}</p>}
  </div>;
}
