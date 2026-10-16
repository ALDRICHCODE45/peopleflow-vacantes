import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionStatusSlot } from "@/components/feedback/action-status";

export function DeliverySkeleton() {
  return <section aria-busy="true" aria-label="Entrega" className="flex flex-col gap-4">
    <span role="status" className="sr-only">Cargando entrega</span>
    <Card aria-hidden="true">
      <CardHeader className="gap-3 border-b"><Skeleton className="h-6 w-32" /><Skeleton className="h-10 w-full" /></CardHeader>
      <CardContent className="flex flex-col gap-7">
        {[1, 2, 3].map(key => <div key={key} className="flex flex-col gap-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-10 w-full" /><Skeleton className="h-5 w-full" /></div>)}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2 border-t"><Skeleton className="h-10 w-64 self-end" /><ActionStatusSlot /></CardFooter>
    </Card>
  </section>;
}
