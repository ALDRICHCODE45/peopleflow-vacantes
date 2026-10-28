import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
export function ChecklistSkeleton() {
  return <Card aria-busy="true" aria-label="Checklist"><span role="status" className="sr-only">Cargando checklist</span><CardHeader className="border-b"><CardTitle><Skeleton aria-hidden="true" className="h-5 w-32" /></CardTitle><CardDescription><Skeleton aria-hidden="true" className="h-5 w-full" /></CardDescription></CardHeader><CardContent className="flex flex-col gap-5"><Skeleton aria-hidden="true" className="h-28 w-full" /><Skeleton aria-hidden="true" className="h-10 w-40" /><Skeleton aria-hidden="true" className="h-32 w-full" /></CardContent><CardFooter className="border-t"><Skeleton aria-hidden="true" className="ml-auto h-10 w-36" /></CardFooter></Card>;
}
