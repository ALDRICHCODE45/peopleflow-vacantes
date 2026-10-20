import { BriefcaseIcon, Clock3Icon, FileTextIcon, Globe2Icon, LayersIcon, MapPinIcon, TrendingUpIcon, type LucideIcon } from "lucide-react";
import type { PublicItemPresentation } from "./public-detail-presentation";
import { CONTRACT_TYPE_OPTIONS, PROFESSIONAL_AREA_OPTIONS, SENIORITY_OPTIONS, WORK_MODE_OPTIONS, WORK_SCHEDULE_OPTIONS, type DraftOption } from "../drafts/ui/draft-labels";
import { employmentTypeLabel } from "../formatters";
import { PUBLIC_DETAIL_FACTS } from "./public-vacancy-layout";

const label = (options: DraftOption[], value: string | null) => options.find((option) => option.value === value)?.label ?? "Sin definir";
type Fact = { key: string; label: string; value: string; title?: string; Icon: LucideIcon };

const joinNames = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;

function remoteScopeFact(job: PublicItemPresentation): Fact[] {
  if (job.work_mode !== "remote" || job.remote_scope === null) return [];
  const scope = job.remote_scope;
  if (scope.kind === "anywhere") return [{ key: "remote_scope", label: "Alcance remoto", value: "Desde cualquier lugar", Icon: Globe2Icon }];
  const names = scope.countries.map(country => country.name);
  const full = `Solo desde ${joinNames(names)}`;
  return [{ key: "remote_scope", label: "Alcance remoto", Icon: Globe2Icon,
    value: names.length > 3 ? `Solo desde ${names.slice(0, 2).join(", ")} y ${names.length - 2} más` : full,
    title: names.length > 3 ? full : undefined }];
}

/** Shared public metadata, without inferred legacy dimensions or prototype data. */
export function publicJobFacts(job: PublicItemPresentation): Fact[] {
  const facts: Fact[] = [];
  if (job.location_label !== null) facts.push({ key: "location", label: "Ubicación", value: job.location_label, Icon: MapPinIcon });
  facts.push(...remoteScopeFact(job));
  facts.push({ key: "work_mode", label: "Modalidad", value: label(WORK_MODE_OPTIONS, job.work_mode), Icon: Globe2Icon });
  if (job.source === "legacy") {
    facts.push({ key: "legacy_employment_type", label: "Tipo de empleo", value: employmentTypeLabel(job.legacy_employment_type), Icon: BriefcaseIcon });
  } else {
    facts.push(
      { key: "work_schedule", label: "Jornada", value: label(WORK_SCHEDULE_OPTIONS, job.work_schedule), Icon: Clock3Icon },
      { key: "contract_type", label: "Contrato", value: label(CONTRACT_TYPE_OPTIONS, job.contract_type), Icon: FileTextIcon },
      { key: "professional_area", label: "Área profesional", value: label(PROFESSIONAL_AREA_OPTIONS, job.professional_area), Icon: LayersIcon },
    );
  }
  if (job.seniority !== null) facts.push({ key: "seniority", label: "Nivel", value: label(SENIORITY_OPTIONS, job.seniority), Icon: TrendingUpIcon });
  return facts;
}

export function publicJobConditions(job: PublicItemPresentation): Fact[] {
  const facts = publicJobFacts(job);
  const keys = ["work_mode", "remote_scope", "location", "work_schedule", "legacy_employment_type"];
  return keys.flatMap(key => facts.filter(fact => fact.key === key));
}

export function publicJobSecondaryFacts(job: PublicItemPresentation): Fact[] {
  const facts = publicJobFacts(job);
  return ["contract_type", "seniority", "professional_area"].flatMap(key => facts.filter(fact => fact.key === key));
}

export function publicJobHeroFacts(job: PublicItemPresentation): Fact[] {
  return publicJobFacts(job).filter(fact => ["work_mode", "work_schedule", "legacy_employment_type", "professional_area"].includes(fact.key));
}

export function PublicJobFacts({ job }: { job: PublicItemPresentation }) {
  return <dl className={PUBLIC_DETAIL_FACTS}>
    {publicJobFacts(job).map(({ key, label, value, title, Icon }) => <div key={key} data-fact={key} className="flex min-w-0 flex-col gap-2">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{label}</dt>
      <dd title={title} aria-label={title} className="break-words text-sm font-medium">{value}</dd>
    </div>)}
  </dl>;
}
