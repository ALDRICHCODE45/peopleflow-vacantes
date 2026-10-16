import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { PublicJobCardSkeleton } from "@/features/jobs/components/PublicJobSkeleton";

export default function Loading() {
  return <section aria-busy="true" aria-label="Listado de vacantes" className="flex flex-col gap-6">
    <span role="status" className="sr-only">Cargando vacantes</span>
    <Skeleton aria-hidden="true" className="h-5 w-32" /><Skeleton aria-hidden="true" className="h-12 w-3/4" />
    <Skeleton aria-hidden="true" className="h-5 w-1/2" />
    <Card><CardContent className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} aria-hidden="true" className="h-10 w-full" />)}</CardContent></Card>
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <Card className="hidden shrink-0 md:block md:w-60"><CardContent className="flex flex-col gap-4">{[0, 1, 2, 3, 4].map((key) => <Skeleton key={key} aria-hidden="true" className="h-10 w-full" />)}</CardContent></Card>
      <div className="flex min-w-0 flex-1 flex-col gap-4"><Skeleton aria-hidden="true" className="h-6 w-48" />{[0, 1, 2].map((key) => <PublicJobCardSkeleton key={key} />)}</div>
    </div>
  </section>;
}
