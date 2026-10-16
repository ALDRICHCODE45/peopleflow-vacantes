import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function PipelineEditorSkeleton() {
  return <section aria-busy="true" aria-label="Pipeline" className="flex flex-col gap-5">
    <span role="status" className="sr-only">Cargando pipeline</span>
    <Card aria-hidden="true">
      <CardHeader className="border-b"><Skeleton className="h-6 w-52" /><Skeleton className="h-5 w-96 max-w-full" /></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" /><Skeleton className="h-10 flex-1" /><Skeleton className="h-10 w-24" />
        </div>)}
        <Skeleton className="h-10 w-44" /><Skeleton className="h-6 w-40" /><Skeleton className="h-10 w-full" />
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t"><Skeleton className="h-10 w-40" /><Skeleton className="h-10 w-40" /></CardFooter>
    </Card>
    <div aria-hidden="true" className="flex gap-3 overflow-hidden">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 w-52 shrink-0" />)}</div>
  </section>;
}
