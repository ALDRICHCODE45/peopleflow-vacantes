import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionBar } from "@/components/feedback/action-status";

// Skeleton exception: the same header, three fields and two footer actions as DeliveryEditor.
export function DeliverySkeleton() {
  return <section aria-busy="true" aria-label="Entrega" className="flex flex-col gap-4">
    <span role="status" className="sr-only">Cargando entrega</span>
    <Card aria-hidden="true">
      <CardHeader className="border-b">
        <CardTitle><Skeleton className="h-6 w-20" /></CardTitle>
        <CardDescription><Skeleton className="h-10 w-full" /></CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {[0, 1, 2].map(index => <Field key={index}>
            <FieldLabel><Skeleton className="h-5 w-40" /></FieldLabel>
            <Skeleton className={index === 2 ? "h-10 w-44" : "h-10 w-full"} />
            <Skeleton className={index === 2 ? "h-10 w-full" : "h-5 w-full"}><FieldDescription className="invisible">&nbsp;</FieldDescription></Skeleton>
          </Field>)}
        </FieldGroup>
      </CardContent>
      <CardFooter className="border-t"><ActionBar status={null}><Skeleton className="h-10 w-36" /><Skeleton className="h-10 w-36" /></ActionBar></CardFooter>
    </Card>
  </section>;
}
