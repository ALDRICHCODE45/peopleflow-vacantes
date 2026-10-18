import { BriefcaseIcon, Building2Icon, ClockIcon, FileTextIcon, GlobeIcon, LayoutGridIcon, MapPinIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";
import type { PublicJobItem } from "../types";
import { CONTRACT_TYPE_OPTIONS, PROFESSIONAL_AREA_OPTIONS, SENIORITY_OPTIONS, WORK_MODE_OPTIONS, WORK_SCHEDULE_OPTIONS, type DraftOption } from "../drafts/ui/draft-labels";
import { employmentTypeLabel } from "../formatters";

const label = (options: DraftOption[], value: string) => options.find((option) => option.value === value)!.label;
type Fact = { key: string; label: string; value: string; Icon: LucideIcon };

/** Shared public metadata, without inferred legacy dimensions or prototype data. */
export function publicJobFacts(job: PublicJobItem): Fact[] {
  const facts: Fact[] = [];
  if (job.location) facts.push({ key: "location", label: "Ubicación", value: job.location, Icon: MapPinIcon });
  facts.push({ key: "work_mode", label: "Modalidad", value: label(WORK_MODE_OPTIONS, job.work_mode), Icon: GlobeIcon });
  if (job.source === "legacy") {
    facts.push({ key: "legacy_employment_type", label: "Tipo de empleo", value: employmentTypeLabel(job.legacy_employment_type), Icon: BriefcaseIcon });
  } else {
    facts.push(
      { key: "work_schedule", label: "Jornada", value: label(WORK_SCHEDULE_OPTIONS, job.work_schedule), Icon: ClockIcon },
      { key: "contract_type", label: "Tipo de contrato", value: label(CONTRACT_TYPE_OPTIONS, job.contract_type), Icon: FileTextIcon },
      { key: "professional_area", label: "Área profesional", value: label(PROFESSIONAL_AREA_OPTIONS, job.professional_area), Icon: LayoutGridIcon },
    );
  }
  if (job.seniority !== null) facts.push({ key: "seniority", label: "Nivel", value: label(SENIORITY_OPTIONS, job.seniority), Icon: TrendingUpIcon });
  return facts;
}

/** Compact card chips: location belongs to the identity meta line, never a duplicate chip. */
export function publicJobChips(job: PublicJobItem): Fact[] {
  const order = ["work_mode", "work_schedule", "legacy_employment_type", "contract_type", "seniority", "professional_area"];
  return publicJobFacts(job)
    .filter(fact => fact.key !== "location")
    .map(fact => fact.key === "work_mode" ? { ...fact, Icon: job.work_mode === "remote" ? GlobeIcon : job.work_mode === "hybrid" ? Building2Icon : MapPinIcon } : fact)
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export function PublicJobFacts({ job }: { job: PublicJobItem }) {
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
    {publicJobFacts(job).map(({ key, label, value, Icon }) => <div key={key} className="flex min-w-0 flex-col gap-1">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon aria-hidden="true" className="size-3.5 shrink-0" />{label}</dt>
      <dd className="break-words text-sm text-foreground">{value}</dd>
    </div>)}
  </dl>;
}
