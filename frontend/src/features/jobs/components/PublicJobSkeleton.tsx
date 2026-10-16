import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function PublicJobCardSkeleton() {
  return <Card>
    <CardHeader className="border-b"><div className="flex items-center gap-3"><Skeleton aria-hidden="true" className="size-10 shrink-0 rounded-full" /><div className="flex flex-1 flex-col gap-2"><Skeleton aria-hidden="true" className="h-6 w-3/4" /><Skeleton aria-hidden="true" className="h-4 w-1/3" /></div></div></CardHeader>
    <CardContent className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((key) => <div key={key} className="flex flex-col gap-2"><Skeleton aria-hidden="true" className="h-3 w-20" /><Skeleton aria-hidden="true" className="h-4 w-3/4" /></div>)}</CardContent>
    <CardFooter className="flex justify-between gap-3 border-t"><Skeleton aria-hidden="true" className="h-4 w-1/2" /><Skeleton aria-hidden="true" className="h-10 w-28" /></CardFooter>
  </Card>;
}

export function PublicJobDetailSkeleton() {
  return <section aria-busy="true" aria-label="Detalle de vacante" className="flex flex-col gap-6">
    <span role="status" className="sr-only">Cargando vacante</span>
    <Skeleton aria-hidden="true" className="h-10 w-28" />
    <PublicJobCardSkeleton />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <Card><CardHeader className="border-b"><Skeleton aria-hidden="true" className="h-6 w-48" /></CardHeader><CardContent className="flex flex-col gap-3">{[0, 1, 2, 3, 4].map((key) => <Skeleton key={key} aria-hidden="true" className="h-4 w-full" />)}</CardContent></Card>
      <Card><CardHeader><Skeleton aria-hidden="true" className="h-6 w-32" /></CardHeader><CardContent><Skeleton aria-hidden="true" className="h-12 w-full" /></CardContent></Card>
    </div>
  </section>;
}
