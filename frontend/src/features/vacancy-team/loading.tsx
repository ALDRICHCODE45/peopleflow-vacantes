import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Same card parts, two identities, action areas and two-column layout as the owner fixture. */
export function TeamSkeleton() {
  return <div aria-busy="true" className="flex flex-col gap-5"><span role="status" className="sr-only">Cargando equipo y movimientos</span>
    <div aria-hidden="true" className="grid items-start gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card><CardHeader><CardTitle><Skeleton className="h-5 w-32" /></CardTitle><CardDescription><Skeleton className="h-4 w-44" /></CardDescription><CardAction><Skeleton className="h-5 w-24" /></CardAction></CardHeader><CardContent><Skeleton className="h-12 w-full" /></CardContent><CardFooter><Skeleton className="h-10 w-32" /></CardFooter></Card>
        <Card><CardHeader className="border-b"><CardTitle><Skeleton className="h-5 w-32" /></CardTitle><CardDescription><Skeleton className="h-4 w-44" /></CardDescription><CardAction><Skeleton className="h-5 w-8" /></CardAction></CardHeader><CardContent><ul className="flex flex-col gap-5">{[0, 1].map(index => <li key={index} className="flex items-start gap-3"><Skeleton className="size-10 shrink-0 rounded-full" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-28" /><Skeleton className="h-5 w-20" /><Skeleton className="h-8 w-full" /></div><Skeleton className="size-10" /></li>)}</ul></CardContent><CardFooter><Skeleton className="h-10 w-40" /></CardFooter></Card>
      </div>
      <div className="flex min-w-0 flex-col gap-4"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-full" />{[0, 1, 2].map(index => <Card key={index}><CardHeader><CardTitle><Skeleton className="h-5 w-48 max-w-full" /></CardTitle><CardDescription><Skeleton className="h-4 w-32" /></CardDescription></CardHeader><CardContent><Skeleton className="h-20 w-full" /></CardContent></Card>)}</div>
    </div>
  </div>;
}
