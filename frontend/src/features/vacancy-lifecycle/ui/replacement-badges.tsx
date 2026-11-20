import Link from "next/link";
import { ArrowUpRight, GitFork } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { vacancyPipelineHref } from "@/features/employer-vacancies/model";
import { linkedProcesses } from "../replacement-state";
import type { Lifecycle } from "../model";

/** «Reemplazo» (+ «Privada» while it has no public listing). `kind`/`visibility` come from a lifecycle view or a draft-list row; absent (old backend) ⇒ nothing. */
export function ReplacementTags({ kind, visibility }: { kind?: Lifecycle["kind"]; visibility?: Lifecycle["visibility"] }) {
  if (kind !== "replacement") return null;
  return <>
    <Badge variant="accent"><GitFork aria-hidden="true" />Reemplazo</Badge>
    {visibility === "private" && <Badge variant="info">Privada</Badge>}
  </>;
}
/** S6: the tags beside the lifecycle state of the page header. */
export function ReplacementBadges({ lifecycle }: { lifecycle: Lifecycle }) {
  return <ReplacementTags kind={lifecycle.kind} visibility={lifecycle.visibility} />;
}

/** S6 link bar under the page header: a replacement points back to its original, a process with an active replacement points forward. */
export function ReplacementLinkBar({ lifecycle, selfId }: { lifecycle: Lifecycle; selfId: string }) {
  const { replacement, replacementOf, activeReplacementId } = linkedProcesses(lifecycle, selfId);
  const toOriginal = replacement && replacementOf;
  if (!toOriginal && !activeReplacementId) return null;
  return <div className="flex shrink-0 flex-col gap-2" data-pf-replacement-links="">
    {toOriginal && <LinkBar href={vacancyPipelineHref(replacementOf)} action="Ver original">Este proceso es un reemplazo de la vacante original.</LinkBar>}
    {activeReplacementId && <LinkBar href={vacancyPipelineHref(activeReplacementId)} action="Ver reemplazo">Esta vacante tiene un <strong className="font-medium text-foreground">reemplazo en curso</strong>.</LinkBar>}
  </div>;
}
function LinkBar({ href, action, children }: { href: string; action: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
    <p className="flex min-w-0 items-center gap-2"><GitFork aria-hidden="true" className="size-4 shrink-0" /><span>{children}</span></p>
    <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link href={href} />}>{action}<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Button>
  </div>;
}
