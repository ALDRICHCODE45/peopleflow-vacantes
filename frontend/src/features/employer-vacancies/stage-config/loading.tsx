import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemMedia } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionBar } from "@/components/feedback/action-status";
import { POSITION_MEDALLION } from "./reorder";

function StageRowSkeleton({ exit = false, fixed = false, inProcess = false }: { exit?: boolean; fixed?: boolean; inProcess?: boolean }) {
  return <Item render={exit ? <div /> : <li />} variant="outline">
    {fixed || exit ? <span className="size-10 shrink-0" /> : <Skeleton className="size-10 shrink-0" />}
    <ItemMedia variant="icon" className={POSITION_MEDALLION}><Skeleton className="size-4" /></ItemMedia>
    <ItemContent className="min-w-40"><FieldGroup><Field>
      <FieldLabel className="sr-only"><Skeleton className="h-5 w-32" /></FieldLabel>
      <Skeleton className="h-10 w-full" />
    </Field></FieldGroup>{inProcess && <Skeleton className="h-5 w-28" />}</ItemContent>
    {!exit && <ItemActions>{fixed ? <Skeleton className="h-4 w-24" /> : <Skeleton className="size-10" />}</ItemActions>}
  </Item>;
}

// Skeleton exception: default five stage rows, the separate exit and their six preview cards.
export function PipelineEditorSkeleton() {
  return <section aria-busy="true" aria-label="Pipeline" className="flex flex-col gap-5">
    <span role="status" className="sr-only">Cargando pipeline</span>
    <Card aria-hidden="true">
      <CardHeader className="border-b has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
        <CardTitle><Skeleton className="h-6 w-44" /></CardTitle>
        <CardDescription><Skeleton className="h-10 w-full" /></CardDescription>
        <CardAction className="col-start-1 row-span-1 row-start-auto justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end"><Skeleton className="h-5 w-44" /></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ol className="flex flex-col gap-3">{Array.from({ length: 5 }, (_, index) => <StageRowSkeleton key={index} fixed={index === 0 || index === 4} inProcess={index === 3} />)}</ol>
        <div className="flex flex-col items-start gap-2"><Skeleton className="h-10 w-40" /></div>
        <Separator />
        <section className="flex flex-col gap-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-5 w-full" /><StageRowSkeleton exit /></section>
      </CardContent>
      <CardFooter className="border-t"><ActionBar status={null}><Skeleton className="h-10 w-36" /><Skeleton className="h-10 w-36" /></ActionBar></CardFooter>
    </Card>
    <section aria-hidden="true" className="flex min-w-0 flex-col gap-3">
      <Skeleton className="h-6 w-32" />
      <div className="flex gap-4 overflow-x-auto rounded-lg p-1">
        <div className="flex gap-3">{Array.from({ length: 5 }, (_, index) => <PreviewSkeleton key={index} />)}</div>
        <Separator orientation="vertical" className="h-auto self-stretch" />
        <PreviewSkeleton />
      </div>
    </section>
  </section>;
}
function PreviewSkeleton() {
  return <Card size="sm" className="w-52 shrink-0"><CardHeader><CardTitle><Skeleton className="h-6 w-24" /></CardTitle><CardAction><Skeleton className="h-5 w-16" /></CardAction></CardHeader><CardContent><Skeleton className="h-4 w-40" /></CardContent></Card>;
}
