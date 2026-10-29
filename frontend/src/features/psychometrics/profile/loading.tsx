import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
export function ProfileSkeleton() {
  return <Card aria-busy="true" aria-label="Psicometría"><span role="status" className="sr-only">Cargando perfil psicométrico</span>
    <CardHeader className="border-b"><CardTitle><Skeleton className="h-5 w-32" /></CardTitle><CardDescription><Skeleton className="h-4 w-64 max-w-full" /></CardDescription><CardAction><Skeleton className="h-5 w-32" /></CardAction></CardHeader>
    <CardContent aria-hidden="true" className="flex flex-col gap-6"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-48" />{Array.from({ length: 7 }, (_, index) => <div key={index} className="grid gap-3 border-b border-border pb-4 sm:grid-cols-2"><Skeleton className="h-5 w-40 sm:col-span-2" /><Skeleton className="h-4 w-full sm:col-span-2" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-16 w-full sm:col-span-2" /></div>)}<Skeleton className="h-4 w-full" /><div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div></CardContent>
    <CardFooter className="border-t" aria-hidden="true"><Skeleton className="h-20 w-full" /></CardFooter>
  </Card>;
}
