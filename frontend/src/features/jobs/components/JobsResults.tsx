import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StateCard } from "@/components/feedback/state-card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { listJobs } from "../api/listJobs";
import { buildJobsUrl, type JobsQuery } from "../url";
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
  if (result.data.items.length === 0) return <StateCard icon={SearchXIcon} tone="empty" title="No hay vacantes"
    description="No encontramos vacantes para esta búsqueda. Quita los filtros para volver a ver el catálogo disponible."
    primaryAction={{ href: "/vacantes", label: "Quitar filtros" }} />;
  return <>
    <ul aria-label="Listado de vacantes" className="flex flex-col gap-4">{result.data.items.map((job) => <VacancyCard key={job.id} job={job} />)}</ul>
    {result.data.next_cursor && <div className="flex justify-center pt-4"><Link href={buildJobsUrl({ ...query, cursor: result.data.next_cursor })} data-jobs-next-link="true" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "group/next min-h-10")}><Spinner aria-hidden="true" data-icon="inline-start" className="hidden group-aria-busy/next:block" />Ver más vacantes</Link></div>}
  </>;
}
