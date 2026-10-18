import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicJobCardSkeleton } from "@/features/jobs/components/PublicJobSkeleton";

/** Label + control pair with the loaded Field geometry (label line, 40px control). */
function FieldSkeleton({ className }: { className?: string }) {
  return <div data-skeleton-field className={className}>
    <Skeleton aria-hidden="true" className="mb-2 h-4 w-24" />
    <Skeleton aria-hidden="true" className="h-10 w-full" />
  </div>;
}

/**
 * Mirrors app/(public)/vacantes/page.tsx and JobsNavigationIsland: hero, the
 * content-only search card (two fields + «Buscar»), four quick filters, the
 * «Filtros» card (header + four selects + two buttons) and the results column.
 */
export default function Loading() {
  return <div aria-busy="true" aria-label="Listado de vacantes" className="flex flex-col gap-8">
    <span role="status" className="sr-only">Cargando vacantes</span>
    <section>
      <Skeleton aria-hidden="true" className="h-4 w-32" />
      <Skeleton aria-hidden="true" className="mt-3 h-12 w-full max-w-2xl md:h-14" />
      <Skeleton aria-hidden="true" className="mt-3 h-6 w-full max-w-xl" />
    </section>
    <div className="flex flex-col gap-6 md:-mx-[7px]">
      <Card>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
          <FieldSkeleton className="min-w-0 flex-1" />
          <FieldSkeleton className="min-w-0 flex-1" />
          <Skeleton data-skeleton-button aria-hidden="true" className="h-10 w-full md:w-28" />
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-2">
        {["w-20", "w-24", "w-24", "w-36"].map((width, key) => <Skeleton key={key} data-skeleton-quick-filter aria-hidden="true" className={`h-10 ${width}`} />)}
      </div>
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="hidden w-full shrink-0 md:block md:w-60">
          <Card>
            <CardHeader className="border-b"><CardTitle><Skeleton aria-hidden="true" className="h-5 w-20" /></CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-4">{[0, 1, 2, 3].map((key) => <FieldSkeleton key={key} />)}</div>
              <div className="flex flex-col gap-2">
                <Skeleton data-skeleton-button aria-hidden="true" className="h-10 w-full" />
                <Skeleton data-skeleton-button aria-hidden="true" className="h-10 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
        <div data-skeleton-results className="flex min-w-0 flex-1 flex-col gap-4">
          <Skeleton aria-hidden="true" className="h-7 w-56" />
          <div className="flex min-w-0 flex-col gap-2">{[0, 1, 2].map((key) => <PublicJobCardSkeleton key={key} />)}</div>
        </div>
      </div>
    </div>
  </div>;
}
