"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Check, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChoiceList, type ChoiceOption } from "@/components/ui/choice-list";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { createDocumentLinkAction, listDocumentSourcesAction } from "../actions";
import { mapDocumentFailure } from "../failure";
import type { DocumentOverview, DocumentSources, LinkWrite } from "../model";
import { FormatBadge } from "./format-badge";
import { FORMAT_LABEL, originLabel, plural, sizeLabel } from "./format";

type Sources = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; sources: DocumentSources };
type Destination = { participationId: string | null; label: string };
type SourceDocument = DocumentSources["sources"][number]["documents"][number];

/** Where a link can go: the vacancy and/or the chosen person, each only if its own `allowed_actions` carries «link». */
export function linkDestinations(overview: DocumentOverview, chosenParticipationId: string | null): Destination[] {
  const person = overview.participations.find(entry => entry.participation_id === chosenParticipationId);
  const destinations: Destination[] = [];
  if (person?.scope_allowed_actions.includes("link")) destinations.push({ participationId: person.participation_id, label: `A ${person.candidate.full_name.split(/\s+/)[0]}` });
  if (overview.scope.allowed_actions.includes("link")) destinations.push({ participationId: null, label: "A la vacante" });
  return destinations;
}

/**
 * «Vincular del proceso original» (S6, REP-13): reads `document-sources` of the destination scope, lists the original chain's documents by
 * origin with their current version, marks the ones already linked, and links the chosen ones ONE BY ONE with `{document_id, version}`.
 * The version shown is always the one sent (pinned), so the link stays on what the person saw even if the original moves meanwhile. Each
 * `{link, scope}` answer is handed to `onLinked`; the first failure stops the run and says which document it was.
 */
export function LinkSheet({ draftId, overview, chosenParticipationId, onClose, onLinked, onDone, onReload, finalFocus }: {
  draftId: string; overview: DocumentOverview; chosenParticipationId: string | null; onClose: () => void;
  onLinked: (write: LinkWrite, participationId: string | null) => void; onDone: (count: number) => void; onReload: () => void;
  finalFocus?: ComponentProps<typeof SheetContent>["finalFocus"];
}) {
  const destinations = linkDestinations(overview, chosenParticipationId);
  const [destination, setDestination] = useState<string | null>(destinations[0]?.participationId ?? null);
  const [sources, setSources] = useState<Sources>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [linked, setLinked] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let current = true;
    setSources({ status: "loading" });
    listDocumentSourcesAction({ draftId, ...(destination ? { participationId: destination } : {}) })
      .catch(() => mapDocumentFailure({ error: { kind: "network" } }))
      .then(result => { if (current) setSources(result.ok ? { status: "ready", sources: result.data } : { status: "error", message: result.message }); });
    return () => { current = false; };
  }, [draftId, destination, attempt]);

  const groups = sources.status === "ready" ? sources.sources.sources : [];
  const canLink = sources.status === "ready" && sources.sources.can_link;
  const documents = groups.flatMap(group => group.documents);
  const isLinked = (document: SourceDocument) => document.already_linked || linked.includes(document.id);
  const picked = documents.filter(document => chosen.includes(document.id) && !isLinked(document));
  const vacancyTarget = destination === null;
  const free = overview.scope.limits.max_documents - overview.scope.counts.documents - overview.scope.counts.links;

  function changeDestination(next: string | null) {
    if (next === destination || linking) return;
    setDestination(next); setChosen([]); setLinked([]); setFailure(null);
  }

  async function link() {
    setFailure(null); setLinking(true);
    let done = 0;
    for (const document of picked) {
      const result = await createDocumentLinkAction({ draftId, ...(destination ? { participationId: destination } : {}), sourceDocumentId: document.id, version: document.version })
        .catch(() => mapDocumentFailure({ error: { kind: "network" } }));
      if (!result.ok) {
        setFailure(`${document.name}: ${result.message}`);
        if (result.reason === "document_already_linked") setLinked(current => [...current, document.id]);
        if (result.reload) onReload();
        setLinking(false);
        if (done > 0) onDone(done);
        return;
      }
      done += 1;
      onLinked(result.data, destination);
      setLinked(current => [...current, document.id]);
    }
    setLinking(false);
    onDone(done);
    onClose();
  }

  return <Sheet open onOpenChange={next => { if (!next && !linking) onClose(); }}>
    <SheetContent showCloseButton={false} finalFocus={finalFocus} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
      <SheetHeader className="border-b">
        <SheetTitle>Vincular del proceso original</SheetTitle>
        <SheetDescription>No se copia ningún archivo: se fija la versión actual. Si el original cambia, verás «hay una versión más nueva».</SheetDescription>
        {destinations.length > 1 && <div role="group" aria-label="Destino del vínculo" className="flex gap-2 pt-2">
          {destinations.map(entry => <Button key={entry.participationId ?? "vacancy"} type="button" size="sm" className="min-h-10" variant={entry.participationId === destination ? "default" : "outline"}
            aria-pressed={entry.participationId === destination} disabled={linking} onClick={() => changeDestination(entry.participationId)}>{entry.label}</Button>)}
        </div>}
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
        {sources.status === "loading" && <div role="status" aria-label="Cargando documentos del proceso original" className="flex flex-col gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
        {sources.status === "error" && <div role="alert" className="flex flex-col items-start gap-2 text-sm"><p>{sources.message}</p>
          <Button type="button" variant="outline" className="min-h-10" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button></div>}
        {sources.status === "ready" && !canLink && <p className="rounded-2xl bg-muted px-4 py-3 text-sm">Aquí no se pueden vincular documentos: solo un reemplazo o una persona retomada del proceso original puede hacerlo, y su espacio no debe estar lleno.</p>}
        {sources.status === "ready" && canLink && documents.length === 0 && <p className="text-sm text-muted-foreground">El proceso original no tiene documentos para vincular.</p>}
        {sources.status === "ready" && canLink && groups.map(group => <section key={`${group.process_id}-${group.participation_id ?? "v"}`} aria-label={originLabel(group.sequence)} className="flex flex-col gap-2">
          <h3 className="font-heading text-sm font-semibold">{originLabel(group.sequence)}</h3>
          <ChoiceList multiple legend={originLabel(group.sequence)} hideLegend disabled={linking} value={chosen.filter(id => group.documents.some(entry => entry.id === id && !isLinked(entry)))}
            countLabel={(selected, total) => selected === 0 ? "Ningún documento elegido" : `${selected} de ${total} documentos elegidos`}
            onValueChange={next => { setFailure(null); setChosen(current => [...current.filter(id => !group.documents.some(entry => entry.id === id)), ...next]); }}
            options={group.documents.map((document): ChoiceOption => {
              const done = isLinked(document);
              return { value: document.id, title: document.name, leading: <FormatBadge format={document.format} />, disabled: done,
                description: `${FORMAT_LABEL[document.format]} · ${sizeLabel(document.size)} · versión actual v${document.version}`,
                meta: done ? <Badge variant="neutral" className="shrink-0"><Check aria-hidden="true" />Ya vinculado</Badge>
                  : chosen.includes(document.id) ? <span className="text-primary-text">{`Se fijará la versión ${document.version}`}</span> : undefined };
            })} />
        </section>)}
        {failure && <p role="alert" className="text-sm text-status-danger">{failure}</p>}
      </div>
      <SheetFooter className="border-t sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {vacancyTarget && sources.status === "ready" && <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:w-full">{`Quedan ${Math.max(0, free)} de ${overview.scope.limits.max_documents} espacios`}</span>}
        <SheetClose render={<Button type="button" variant="outline" className="min-h-10" disabled={linking} />}>Cancelar</SheetClose>
        <Button type="button" className="min-h-10" disabled={picked.length === 0 || linking} aria-busy={linking || undefined} onClick={link}>
          {linking ? "Vinculando…" : <><Link2 aria-hidden="true" />{picked.length === 0 ? "Vincular documentos" : `Vincular ${plural(picked.length, "documento", "documentos")}`}</>}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
