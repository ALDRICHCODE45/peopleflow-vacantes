import Link from "next/link";
import { ArrowUpRight, GitFork } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { vacancyPipelineHref } from "@/features/employer-vacancies/model";
import { chainLabel, linkedProcesses, type ChainProcess } from "../replacement-state";
import type { Lifecycle } from "../model";

/** A chain process plus, when the backend names them, the departed hires it replaces (`GET V/replacements`: `replaced_credit_ids` × fallen credits). */
export type NamedChainProcess = ChainProcess & { replaces?: readonly string[] };
/** «Ana», «Ana y Luis», «Ana, Luis y Marta»; past three names the rest collapse into «y N más» so the bar stays one short sentence. */
const MAX_NAMES = 3;
function nameList(names: readonly string[]): string {
  const shown = names.length > MAX_NAMES ? [...names.slice(0, MAX_NAMES - 1), `${names.length - (MAX_NAMES - 1)} más`] : [...names];
  return shown.length < 2 ? shown.join("") : `${shown.slice(0, -1).join(", ")} y ${shown[shown.length - 1]}`;
}

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

/**
 * S6 link line beside the vacancy tabs (S9): a replacement points back to its original, a process with an active replacement points forward.
 * With the chain (the board's single `GET V/replacements`) it names the processes; without it (old backend, failed read, a process the
 * chain does not list) it keeps the unnamed copy. A process the caller cannot open (`canOpen: false`) is named but not linked.
 * When the chain also says which departed hires a replacement covers (`replaces`, from the fallen credits) the bar names them; otherwise the generic copy stays.
 */
export function ReplacementLinkBar({ lifecycle, selfId, chain = [] }: { lifecycle: Lifecycle; selfId: string; chain?: readonly NamedChainProcess[] }) {
  const { replacement, replacementOf, activeReplacementId } = linkedProcesses(lifecycle, selfId);
  const toOriginal = replacement && replacementOf;
  if (!toOriginal && !activeReplacementId) return null;
  const named = (id: string | null) => chain.find(process => process.id === id);
  const self = named(selfId), source = named(replacementOf), active = named(activeReplacementId);
  const root = chain.find(process => process.kind === "original") ?? self;
  const selfWho = self?.replaces?.length ? nameList(self.replaces) : null;
  const activeWho = active?.replaces?.length ? nameList(active.replaces) : null;
  return <div className="flex min-w-0 flex-col" data-pf-replacement-links="">
    {toOriginal && <LinkBar href={source?.canOpen === false ? undefined : vacancyPipelineHref(replacementOf)} action={source && source.kind !== "original" ? `Ver ${chainLabel(source)}` : "Ver original"}>
      {self && root
        ? selfWho ? <><strong className="font-medium text-foreground">{chainLabel(self)}</strong> · Reemplaza a {selfWho} en {root.title}.</> : <>Este proceso es el <strong className="font-medium text-foreground">{chainLabel(self)}</strong> de {root.title}.</>
        : "Este proceso es un reemplazo de la vacante original."}
    </LinkBar>}
    {activeReplacementId && <LinkBar href={active?.canOpen === false ? undefined : vacancyPipelineHref(activeReplacementId)} action={active ? `Ver reemplazo activo: ${chainLabel(active)}` : "Ver reemplazo"}>
      {active ? <>{activeWho ? `Reemplazo en curso para ${activeWho}:` : "Esta vacante tiene un reemplazo en curso:"} <strong className="font-medium text-foreground">{chainLabel(active)}</strong>.</> : <>Esta vacante tiene un <strong className="font-medium text-foreground">reemplazo en curso</strong>.</>}
    </LinkBar>}
  </div>;
}
function LinkBar({ href, action, children }: { href?: string; action: string; children: React.ReactNode }) {
  // S9: one quiet line (no tinted card) that sits beside the vacancy tabs; the icon takes the brand tone (system.md «Colors — dark»).
  return <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
    <p className="flex min-w-0 items-start gap-2"><GitFork aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-text" /><span>{children}</span></p>
    {href && <Button nativeButton={false} role="link" variant="link" className="min-h-10 px-2.5 text-primary-text" render={<Link href={href} />}>{action}<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Button>}
  </div>;
}
