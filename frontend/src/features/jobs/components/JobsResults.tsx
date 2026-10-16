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
  if (!result.ok) return <Empty role="alert">
    <EmptyHeader><EmptyTitle><h2>No se pudieron cargar las vacantes</h2></EmptyTitle><EmptyDescription>El servicio de vacantes no respondió correctamente.</EmptyDescription></EmptyHeader>
    <EmptyContent><Link href={buildJobsUrl(query)} className={cn(buttonVariants(), "min-h-10")}>Intentar de nuevo</Link></EmptyContent>
  </Empty>;
  if (result.data.items.length === 0) return <Empty>
    <EmptyHeader><EmptyMedia variant="icon"><SearchXIcon aria-hidden="true" /></EmptyMedia><EmptyTitle>No hay vacantes</EmptyTitle><EmptyDescription>No encontramos vacantes para esta búsqueda. Prueba con otros filtros.</EmptyDescription></EmptyHeader>
    <EmptyContent><Link href="/vacantes" className={cn(buttonVariants(), "min-h-10")}>Quitar filtros</Link></EmptyContent>
  </Empty>;
  return <>
    <ul aria-label="Listado de vacantes" className="flex flex-col gap-4">{result.data.items.map((job) => <VacancyCard key={job.id} job={job} />)}</ul>
    {result.data.next_cursor && <div className="flex justify-center pt-4"><Link href={buildJobsUrl({ ...query, cursor: result.data.next_cursor })} data-jobs-next-link="true" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-10")}>Ver más vacantes</Link></div>}
  </>;
}
