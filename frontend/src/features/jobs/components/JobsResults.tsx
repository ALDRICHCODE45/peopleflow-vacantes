import Link from "next/link";
import { Briefcase, SearchXIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StateCard } from "@/components/feedback/state-card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { listJobs } from "../api/listJobs";
import { buildJobsUrl, parseJobsQuery, selectedValues, type JobsQuery } from "../url";
import { CONTRACT_TYPE_OPTIONS, PROFESSIONAL_AREA_OPTIONS, SENIORITY_OPTIONS, WORK_MODE_OPTIONS, WORK_SCHEDULE_OPTIONS } from "../drafts/ui/draft-labels";
import { JobsLoadError } from "./jobs-load-error";
import { VacancyCard } from "./VacancyCard";

type ListJobsResult = Awaited<ReturnType<typeof listJobs>>;

export function JobsResults({ result, query }: { result: ListJobsResult; query: JobsQuery }) {
  if (!result.ok && result.error.kind === "status" && result.error.status === 400 && result.envelope) {
    const invalidFilter = result.envelope.code === "invalid_filter" || !query.cursor;
    return <StateCard role="alert" icon={SearchXIcon} tone="error"
      title={invalidFilter ? "No se pudieron aplicar los filtros" : "No se pudo continuar la búsqueda"}
      description={invalidFilter ? "Uno o más filtros ya no son válidos. Quítalos para volver a consultar las vacantes." : "Este enlace de resultados ya no es válido. Vuelve al inicio de la búsqueda conservando tus filtros."}
      primaryAction={{ href: invalidFilter ? "/vacantes" : buildJobsUrl({ ...query, cursor: undefined }), label: invalidFilter ? "Quitar filtros" : "Volver al inicio de la búsqueda" }} />;
  }
  if (!result.ok) return <JobsLoadError />;
  if (result.data.items.length === 0) {
    if (query.cursor) return <StateCard icon={SearchXIcon} tone="empty" title="No hay más vacantes en esta búsqueda"
      description="Vuelve al inicio de la búsqueda conservando tus filtros."
      primaryAction={{ href: buildJobsUrl({ ...query, cursor: undefined }), label: "Volver al inicio de la búsqueda" }} />;
    // Use the same normalization as the public URL: whitespace, empty arrays and
    // salary units without an amount are not active filters.
    const active = parseJobsQuery(buildJobsUrl(query).split("?")[1] ?? "");
    const dimensions = [
      { key: "work_mode", subject: "la modalidad", options: WORK_MODE_OPTIONS },
      { key: "work_schedule", subject: "la jornada", options: WORK_SCHEDULE_OPTIONS },
      { key: "contract_type", subject: "el tipo de contrato", options: CONTRACT_TYPE_OPTIONS },
      { key: "professional_area", subject: "el área", options: PROFESSIONAL_AREA_OPTIONS },
      { key: "seniority", subject: "el nivel", options: SENIORITY_OPTIONS },
      // Geographic/language names require catalogs not available in this server
      // component. Name those active filters without exposing opaque codes.
      { key: "state", subject: "el filtro de estado" },
      { key: "municipality", subject: "el filtro de municipio" },
      { key: "applicant_country", subject: "el filtro de país de residencia" },
      { key: "language", subject: "el filtro de idiomas" },
      { key: "years_of_experience", subject: "el filtro de experiencia" },
      { key: "education_level", subject: "el filtro de estudios" },
      { key: "salary_min", subject: "el filtro de salario mínimo" },
      { key: "salary_max", subject: "el filtro de salario máximo" },
    ] as const;
    const filters = dimensions.flatMap(dimension => {
      const values = selectedValues(active[dimension.key]);
      if (!values.length) return [];
      const labels = "options" in dimension ? values.map(value => dimension.options.find(option => option.value === value)?.label).filter(Boolean) : [];
      return [`${dimension.subject}${labels.length ? ` ${labels.map(label => `«${label}»`).join(", ")}` : ""}`];
    }).join(" y ");
    if (!active.q && !filters) return <StateCard icon={Briefcase} tone="empty" title="Todavía no hay vacantes publicadas"
      description="Las oportunidades aparecerán aquí cuando las empresas las publiquen. No hay ninguna disponible por ahora; puedes volver al inicio de PeopleFlow."
      primaryAction={{ href: "/", label: "Ir al inicio" }} />;
    const description = `${active.q ? `No encontramos vacantes para «${active.q}»${filters ? ` con ${filters}` : ""}` : `No hay vacantes que coincidan con ${filters}`}. Limpia los filtros para consultar el catálogo.`;
    return <StateCard icon={SearchXIcon} tone="empty" title="Sin resultados" description={description}
      primaryAction={{ href: "/vacantes", label: "Limpiar filtros" }} />;
  }
  return <>
    <ul aria-label="Listado de vacantes" className="flex flex-col gap-4">{result.data.items.map((job) => <VacancyCard key={job.id} job={job} />)}</ul>
    {result.data.next_cursor && <div className="flex justify-center pt-4"><Link href={buildJobsUrl({ ...query, cursor: result.data.next_cursor })} data-jobs-next-link="true" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "group/next min-h-10")}><Spinner aria-hidden="true" data-icon="inline-start" className="hidden group-aria-busy/next:block" />Ver más vacantes</Link></div>}
  </>;
}
