import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ProfileSkeleton() {
  return <div aria-busy="true" aria-label="Psicometría" className="flex min-w-0 flex-col gap-5">
    <span role="status" className="sr-only">Cargando perfil psicométrico</span>
    <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-col gap-2"><Skeleton className="h-7 w-32" /><Skeleton className="h-5 w-64 max-w-full" /></div><Skeleton className="h-5 w-40" /></div>
    <Card aria-hidden="true"><CardHeader className="border-b"><CardTitle><Skeleton className="h-6 w-40" /></CardTitle><CardDescription><Skeleton className="h-5 w-48" /></CardDescription><CardAction><Skeleton className="h-5 w-24" /></CardAction></CardHeader>
      <CardContent className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">{Array.from({ length: 3 }, (_, index) => <div key={index} className="flex flex-col gap-2"><Skeleton className="h-5 w-40 max-w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-5 w-full" /></div>)}</CardContent>
      <CardFooter className="border-t"><Skeleton className="h-8 w-full" /></CardFooter>
    </Card>
    <div aria-hidden="true" className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.5fr)]">
      <Card><CardHeader className="border-b"><CardTitle><Skeleton className="h-6 w-40" /></CardTitle><CardDescription><Skeleton className="h-5 w-32" /></CardDescription><CardAction><Skeleton className="h-5 w-6" /></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-2">{Array.from({ length: 7 }, (_, index) => <div key={index} className="flex flex-col gap-2"><Skeleton className="h-5 w-40 max-w-full" /><Skeleton className="h-5 w-full" /></div>)}</CardContent>
        <CardFooter className="border-t"><Skeleton className="h-10 w-full" /></CardFooter>
      </Card>
      <Card className="min-w-0"><CardHeader className="border-b"><CardTitle><Skeleton className="h-6 w-40" /></CardTitle><CardDescription><Skeleton className="h-5 w-48 max-w-full" /></CardDescription><CardAction className="col-start-1 row-span-1 row-start-3 justify-self-start"><Skeleton className="h-10 w-56 max-w-full" /></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-6"><div className="flex flex-col gap-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-9 w-full" /></div><div className="flex flex-col gap-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-9 w-full" /><Skeleton className="h-5 w-20" /></div><Skeleton className="h-12 w-full" /></CardContent>
        <CardFooter className="border-t"><Skeleton className="h-10 w-full" /></CardFooter>
      </Card>
    </div>
    <Skeleton aria-hidden="true" className="h-10 w-full" />
    <Card aria-hidden="true" className="sticky bottom-3"><CardContent className="flex flex-col gap-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-10 w-full" /></CardContent></Card>
  </div>;
}
