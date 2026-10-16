import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function SubstatesEditorSkeleton() {
  return <section aria-busy="true" aria-label="Subestados" className="flex flex-col gap-5">
    <span role="status" className="sr-only">Cargando subestados</span>
    <Card aria-hidden="true">
      <CardHeader className="border-b"><Skeleton className="h-6 w-52" /><Skeleton className="h-5 w-96 max-w-full" /></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, index) => <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0" /><Skeleton className="size-10 shrink-0 rounded-full" /><Skeleton className="h-10 flex-1" /><Skeleton className="size-10 shrink-0" />
        </div>)}
        <Skeleton className="h-10 w-44" /><Skeleton className="h-6 w-40" />
        <div className="flex flex-wrap gap-2"><Skeleton className="h-10 w-40" /><Skeleton className="h-10 w-40" /></div>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2 border-t"><div className="flex flex-wrap justify-end gap-2"><Skeleton className="h-10 w-40" /><Skeleton className="h-10 w-40" /></div><Skeleton className="h-10 w-full" /></CardFooter>
    </Card>
  </section>;
}
