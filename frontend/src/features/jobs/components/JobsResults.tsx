import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import type { listJobs } from "../api/listJobs";
import { buildJobsUrl, type JobsQuery } from "../url";
import { VacancyCard } from "./VacancyCard";

type ListJobsResult = Awaited<ReturnType<typeof listJobs>>;

export function JobsResults({ result, query }: { result: ListJobsResult; query: JobsQuery }) {
  if (!result.ok && result.error.kind === "status" && result.error.status === 400 && result.envelope) {
    const invalidFilter = result.envelope.code === "invalid_filter" || !query.cursor;
    return <Empty role="alert">
      <EmptyHeader><EmptyTitle><h2>{invalidFilter ? "No se pudieron aplicar los filtros" : "No se pudo continuar la búsqueda"}</h2></EmptyTitle>
        <EmptyDescription>{invalidFilter ? "Uno o más filtros ya no son válidos. Quítalos para volver a consultar las vacantes." : "Este enlace de resultados ya no es válido. Vuelve al inicio de la búsqueda conservando tus filtros."}</EmptyDescription></EmptyHeader>
      <EmptyContent><Link href={invalidFilter ? "/vacantes" : buildJobsUrl({ ...query, cursor: undefined })} className={cn(buttonVariants(), "min-h-10 w-full sm:w-auto")}>{invalidFilter ? "Quitar filtros" : "Volver al inicio de la búsqueda"}</Link></EmptyContent>
    </Empty>;
  }
  if (!result.ok) return <Empty role="alert">
    <EmptyHeader className="max-w-md"><EmptyTitle className="text-xl font-semibold"><h2>No se pudieron cargar las vacantes</h2></EmptyTitle><EmptyDescription>El servicio de vacantes no respondió correctamente. Intenta de nuevo para cargar los resultados de tu búsqueda.</EmptyDescription></EmptyHeader>
    <EmptyContent><Link href={buildJobsUrl(query)} className={cn(buttonVariants(), "min-h-10 w-full sm:w-auto")}>Intentar de nuevo</Link></EmptyContent>
  </Empty>;
  if (result.data.items.length === 0) return <Empty>
    <EmptyHeader className="max-w-md"><EmptyMedia variant="icon"><SearchXIcon aria-hidden="true" /></EmptyMedia><EmptyTitle className="text-xl font-semibold">No hay vacantes</EmptyTitle><EmptyDescription>No encontramos vacantes para esta búsqueda. Quita los filtros para volver a ver el catálogo disponible.</EmptyDescription></EmptyHeader>
    <EmptyContent><Link href="/vacantes" className={cn(buttonVariants(), "min-h-10 w-full sm:w-auto")}>Quitar filtros</Link></EmptyContent>
  </Empty>;
  return <>
    <ul aria-label="Listado de vacantes" className="flex flex-col gap-4">{result.data.items.map((job) => <VacancyCard key={job.id} job={job} />)}</ul>
    {result.data.next_cursor && <div className="flex justify-center pt-4"><Link href={buildJobsUrl({ ...query, cursor: result.data.next_cursor })} data-jobs-next-link="true" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-10")}>Ver más vacantes</Link></div>}
  </>;
}
