"use client";
import { useRef, useState } from "react";
import { ArrowRight, CircleCheck, Copy, GitCompareArrows, Info, Search, Flag } from "lucide-react";
import { cn } from "cn";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { StateCard } from "@/components/feedback/state-card";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { MovementDate } from "@/features/pipeline-movement/board-states";
import { plural } from "@/features/employer-vacancies/plural";
import type { AssessmentResult, ComparedCompetency, Comparison, Invitation, Quality } from "../model";
import { bandLabels, competencyLabels, comparisonLabel, facetLabels, fitLabel, focusMessages, importanceLabels, questionReason, signalReason, statusLabels, tierLabels, tierMessages } from "../labels";
import type { useSheetResult } from "./state";
import { readConsequence } from "./feedback";

type Session = ReturnType<typeof useSheetResult>;
export function PsychometricPanel({ invitation, session, locked }: { invitation: Invitation; session: Session; locked?: boolean }) {
  if (invitation.status !== "finished") return <p className="text-sm text-muted-foreground">{statusLabels[invitation.status]} · {invitation.answered_count} de {invitation.total_count} respuestas</p>;
  if (!session.value) return <ResultSkeleton />;
  if (!session.value.ok) return <StateCard icon={Info} tone="error" title="No pudimos cargar el resultado" description={readConsequence(session.value.reason)} primaryAction={{ label: "Reintentar resultado", onClick: session.retry, "aria-describedby": "psychometric-read-status" }}><ActionStatusSlot><ActionStatus id="psychometric-read-status" tone="error" text="No se cargó el resultado" /></ActionStatusSlot></StateCard>;
  return <StoredResult data={session.value.data} session={session} locked={locked} />;
}

function FitBadge({ competency }: { competency: ComparedCompetency }) {
  // Both gaps use the brand accent, never amber/brown or danger. Search means
  // clarify an adjacent difference; Flag marks a key two-band gap without a verdict.
  const Icon = competency.fit === "fit.alineado" ? CircleCheck : competency.fit === "fit.atencion" ? Flag : Search;
  return <Badge variant={competency.fit === "fit.alineado" ? "success" : competency.fit ? "accent" : "neutral"}><Icon aria-hidden="true" data-icon="inline-start" />{fitLabel(competency)}</Badge>;
}
function BandMatrix({ competency }: { competency: ComparedCompetency }) {
  return <div role="region" aria-label={`Bandas · ${competencyLabels[competency.competency_id]}`} className="flex flex-col gap-2">
    {/* Presentation-only ordinal cells, not a progress bar or interactive controls. */}
    <div className="grid grid-cols-3 gap-2" aria-hidden="true">{(Object.keys(bandLabels) as (keyof typeof bandLabels)[]).map(band => <span key={band} data-desired={band === competency.desired_band} data-obtained={band === competency.band} className={cn("rounded-md border border-border py-1 text-center text-xs text-muted-foreground", band === competency.band && "bg-primary text-primary-foreground", band === competency.desired_band && "outline-2 outline-offset-2 outline-muted-foreground")}>{bandLabels[band]}</span>)}</div>
    <p className="text-xs text-muted-foreground">Deseado: {competency.desired_band ? bandLabels[competency.desired_band] : "Sin comparación"} · Obtenido: {bandLabels[competency.band]}</p>
  </div>;
}
function QualitySignals({ quality }: { quality: Quality }) {
  const order = ["signal.attention", "signal.long_string", "signal.fast", "signal.changes"];
  const reasons = [...quality.signals].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).map(signalReason).filter(Boolean);
  return <Item variant="outline"><ItemMedia variant="icon"><Info aria-hidden="true" /></ItemMedia><ItemContent>
    <ItemTitle className="min-w-0 flex-wrap line-clamp-none"><h3>Cómo se respondió</h3><Badge variant={quality.tier === "tier.sin" ? "neutral" : "info"}>{tierLabels[quality.tier]}</Badge></ItemTitle>
    <p className="text-sm leading-6">{tierMessages[quality.tier]}</p>
    {quality.partial && <p className="text-sm text-muted-foreground">Información parcial: no se registraron todos los tiempos o cambios de respuesta.</p>}
    {reasons.length > 0 && <ul className="flex list-disc flex-col gap-2 pl-4 text-sm leading-6">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    <ItemDescription>Estas señales no prueban una intención ni cambian las bandas de personalidad.</ItemDescription>
  </ItemContent></Item>;
}
function StoredResult({ data, session, locked }: { data: AssessmentResult; session: Session; locked?: boolean }) {
  const comparison = data.latest_comparison;
  const [copying, setCopying] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const copyLock = useRef(false);
  async function copyGuide() {
    if (copyLock.current) return;
    copyLock.current = true; setCopying(true); setCopyNotice(null);
    try {
      await navigator.clipboard.writeText(`Cuestionario de personalidad laboral\nGuía de entrevista\n${comparison.guide.map((q, i) => `${i + 1}. ${competencyLabels[q.competency_id]}\nPor qué se sugiere: ${questionReason(q)}\n${q.text}\nQué escuchar: ${q.good_answer_checklist}`).join("\n\n")}`);
      setCopyNotice({ tone: "success", text: "Guía copiada" });
      notifyActionResult({ key: "psychometric-copy", type: "success", title: "Guía copiada", description: "Puedes pegar las preguntas en tus notas de entrevista." });
    } catch {
      setCopyNotice({ tone: "error", text: "No se copió · selecciona las preguntas" });
      notifyActionResult({ key: "psychometric-copy", type: "error", title: "No se pudo copiar la guía", description: "Las preguntas siguen disponibles. Selecciona y copia el texto manualmente.", reference: { code: "clipboard_unavailable", at: new Date().toISOString() } });
    } finally { copyLock.current = false; setCopying(false); }
  }
  const currentProfile = session.profile?.ok ? session.profile.data : null;
  const outdated = currentProfile?.confirmed && currentProfile.version !== comparison.profile_version;
  return <div className="flex min-w-0 flex-col gap-6" data-pf-psychometric-result="">
    <header className="flex flex-col gap-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="success" dot>Finalizado</Badge><span className="text-xs text-muted-foreground"><MovementDate value={data.finished_at} /></span></div><h2 className="text-xl font-semibold">Cuestionario de personalidad laboral</h2><p className="text-sm leading-6 text-muted-foreground">Este resultado resume lo que la persona declaró. Confírmalo con ejemplos de trabajo; no demuestra por sí solo cómo trabaja.</p></header>
    {outdated && <aside role="note" className="flex flex-col gap-3 rounded-lg border-l-2 border-primary bg-primary/[0.06] p-4"><h3 className="text-sm font-medium">El perfil de la vacante cambió</h3><p className="text-sm leading-6">Ves la comparación guardada con {comparisonLabel(comparison.profile_version).toLowerCase()}. El perfil actual es versión {currentProfile.version}. Las bandas no cambian y la comparación anterior se conserva.</p><Button type="button" variant="outline" className="min-h-10 self-start" disabled={locked || session.comparing || session.uncertain} aria-describedby="psychometric-comparison-status" onClick={() => setConfirm(true)}><GitCompareArrows aria-hidden="true" data-icon="inline-start" />Comparar con el perfil actual</Button><ActionStatusSlot>{session.comparisonNotice && <ActionStatus id="psychometric-comparison-status" {...session.comparisonNotice} />}</ActionStatusSlot></aside>}
    <nav aria-label="En este resultado" className="flex flex-wrap gap-2 border-b">{[["guide", "Entrevistar"], ["focus", "Focos y señales"], ["competencies", "Competencias"]].map(([id, text]) => <a key={id} href={`#psychometric-${id}`} className={cn(buttonVariants({ variant: "link" }), "min-h-10")}>{text}</a>)}</nav>
    <section id="psychometric-guide" className="flex scroll-mt-5 flex-col gap-3" aria-labelledby="psychometric-guide-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="psychometric-guide-title" className="text-base font-semibold">Guía de entrevista</h3><Button type="button" className="min-h-10" onClick={() => void copyGuide()} disabled={copying || comparison.guide.length === 0} aria-describedby="psychometric-copy-status"><Copy aria-hidden="true" data-icon="inline-start" />Copiar guía</Button></div>
      <p className="text-xs text-muted-foreground">{plural(comparison.guide.length, "pregunta del banco redactado", "preguntas del banco redactado")}. Pide contexto, acciones y resultados.</p>
      <ActionStatusSlot>{copyNotice && <ActionStatus id="psychometric-copy-status" tone={copyNotice.tone} text={copyNotice.text} />}</ActionStatusSlot>
      <ol className="flex flex-col gap-5">{comparison.guide.map((q, index) => <li key={q.question_id} id={`psychometric-${q.question_id}`} className="flex scroll-mt-5 flex-col gap-3 border-b pb-5">
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><Badge variant="outline">{competencyLabels[q.competency_id]}</Badge></div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{q.text}</p>
        <p className="text-xs leading-5 text-muted-foreground">Por qué se sugiere: {questionReason(q)}.</p>
        <Accordion><AccordionItem value="evidence"><AccordionTrigger>Qué escuchar en el ejemplo</AccordionTrigger><AccordionContent><p className="whitespace-pre-wrap break-words">{q.good_answer_checklist}</p></AccordionContent></AccordionItem></Accordion>
      </li>)}</ol>
      {!comparison.guide.length && <p className="text-sm text-muted-foreground">No hay preguntas almacenadas para esta comparación.</p>}
    </section>
    <section id="psychometric-focus" className="flex scroll-mt-5 flex-col gap-3" aria-labelledby="psychometric-focus-title"><h3 id="psychometric-focus-title" className="text-base font-semibold">Focos para tu entrevista</h3>
      <p className="text-xs text-muted-foreground">Son temas para profundizar, no motivos automáticos de descarte.</p>
      {comparison.focus_areas.length ? <ul className="flex flex-col gap-4">{comparison.focus_areas.map(focus => {
        const competency = focus.type === "focus.quality" ? focus.routed_competency_id : focus.competency_id;
        const question = comparison.guide.find(q => q.competency_id === competency && q.originating_focus_type === focus.type);
        const index = question ? comparison.guide.indexOf(question) + 1 : null;
        return <li key={`${focus.type}-${focus.competency_id}`} className="flex flex-col gap-1"><p className="text-sm leading-6">{focusMessages[focus.type]}</p>{question && <a className="inline-flex min-h-10 items-center gap-2 text-sm underline underline-offset-4" href={`#psychometric-${question.question_id}`}>{competencyLabels[competency]} · Pregunta {index}<ArrowRight aria-hidden="true" className="size-4" /></a>}</li>;
      })}</ul> : <p className="text-sm text-muted-foreground">No hay focos almacenados en esta comparación.</p>}
      <QualitySignals quality={data.quality} />
    </section>
    <section id="psychometric-competencies" className="flex scroll-mt-5 flex-col gap-5" aria-labelledby="psychometric-competencies-title"><h3 id="psychometric-competencies-title" className="text-base font-semibold">El puesto y sus respuestas</h3>
      <p className="text-xs leading-5 text-muted-foreground">Bandas por significado, no percentiles. Ninguna banda es intrínsecamente mejor. Contorno: deseado · Relleno: obtenido.</p>
      {comparison.competencies.map(c => {
        const interpretation = data.interpretations.find(i => i.competency_id === c.competency_id)!;
        return <section key={c.competency_id} aria-label={competencyLabels[c.competency_id]} className="flex flex-col gap-4 border-b pb-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-medium">{competencyLabels[c.competency_id]}</h4><p className="text-xs text-muted-foreground">{importanceLabels[c.importance]}</p></div><FitBadge competency={c} /></div><BandMatrix competency={c} />
          <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{interpretation.intro_text}</p>
          <dl className="flex flex-col gap-3 text-sm leading-6">{[["Cómo se puede ver en el trabajo", interpretation.work_text], ["Fortalezas", interpretation.strengths_text], ["Áreas a desarrollar", interpretation.development_text]].map(([label, text]) => <div key={label}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{text}</dd></div>)}</dl>
          <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{interpretation.hypothesis_text}</p>
        </section>;
      })}
    </section>
    <Accordion><AccordionItem value="facets"><AccordionTrigger>Ver detalle por rasgo · 15 facetas</AccordionTrigger><AccordionContent><section aria-label="Bandas por rasgo"><p className="text-xs text-muted-foreground">Bandas de las respuestas, no diagnósticos.</p><dl>{data.facets.map(facet => <div key={facet.facet_id} className="flex justify-between gap-3 border-b py-2"><dt>{facetLabels[facet.facet_id]}</dt><dd>{bandLabels[facet.band]}</dd></div>)}</dl></section></AccordionContent></AccordionItem></Accordion>
    <section aria-label="Comparaciones" className="flex flex-col gap-3"><h3 className="text-base font-semibold">Comparación con la vacante</h3><p className="text-xs text-muted-foreground">{comparisonLabel(comparison.profile_version)} · <MovementDate value={comparison.created_at} /></p>
      {session.profile && !session.profile.ok && <p className="text-xs text-muted-foreground">No pudimos consultar el perfil actual. Se conserva la comparación almacenada.</p>}
      {!outdated && <ActionStatusSlot>{session.comparisonNotice && <ActionStatus id="psychometric-comparison-status" {...session.comparisonNotice} />}</ActionStatusSlot>}
      <ComparisonHistory comparisons={data.comparisons} latest={comparison.id} />
    </section>
    <p className="text-xs leading-5 text-muted-foreground">Úsalo para preparar la entrevista. La decisión requiere evidencia adicional y revisión humana.</p>
    <ConfirmActionDialog icon={GitCompareArrows} open={confirm} onOpenChange={setConfirm} title="¿Comparar con el perfil actual?" description="Se guardará una nueva comparación y guía. Las bandas originales y el historial no cambian." confirmLabel="Comparar" pendingLabel="Comparando…" pending={session.comparing} onConfirm={() => { void session.compare().then(() => setConfirm(false)); }} />
  </div>;
}
function ComparisonHistory({ comparisons, latest }: { comparisons: AssessmentResult["comparisons"]; latest: Comparison["id"] }) {
  const previous = comparisons.filter(c => c.id !== latest);
  return previous.length ? <div><h4 className="text-sm font-medium">Comparaciones anteriores</h4><ol className="flex flex-col gap-2">{previous.map(c => <li key={c.id} className="text-xs text-muted-foreground">{comparisonLabel(c.profile_version)} · comparación anterior</li>)}</ol></div> : null;
}

/** Skeleton exception: same guide-first sections, ordinal matrix and disclosure
 * slots. Counts are unknown until the audited read returns (guide can have 0–8). */
export function ResultSkeleton() {
  return <div data-pf-result-skeleton="" aria-busy="true" className="flex flex-col gap-6"><span role="status" className="sr-only">Cargando resultado psicométrico</span><div aria-hidden="true" className="flex flex-col gap-6">
    <header className="flex flex-col gap-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-7 w-full" /><Skeleton className="h-12 w-full" /></header>
    <nav className="flex gap-2"><Skeleton className="h-10 w-24" /><Skeleton className="h-10 w-28" /><Skeleton className="h-10 w-24" /></nav>
    <section className="flex flex-col gap-3"><div className="flex justify-between gap-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-10 w-28" /></div><Skeleton className="h-5 w-full" /><ActionStatusSlot /><ol className="flex flex-col gap-5">{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <li key={i} className="flex flex-col gap-3 border-b pb-5"><Skeleton className="h-5 w-44" /><Skeleton className="h-20 w-full" /><Skeleton className="h-10 w-full" /><Accordion><AccordionItem value="evidence"><AccordionTrigger tabIndex={-1}><Skeleton className="h-5 w-44" /></AccordionTrigger><AccordionContent /></AccordionItem></Accordion></li>)}</ol></section>
    <section className="flex flex-col gap-3"><Skeleton className="h-6 w-40" /><Item variant="outline"><ItemMedia variant="icon"><Skeleton className="size-4" /></ItemMedia><ItemContent><ItemTitle><Skeleton className="h-5 w-36" /></ItemTitle><Skeleton className="h-24 w-full" /><Skeleton className="h-5 w-full"><ItemDescription className="invisible">&nbsp;</ItemDescription></Skeleton></ItemContent></Item></section>
    <section className="flex flex-col gap-5"><Skeleton className="h-6 w-44" />{Array.from({ length: 7 }, (_, i) => <div key={i} className="flex flex-col gap-4 border-b pb-5"><Skeleton className="h-10 w-full" /><div className="grid grid-cols-3 gap-2">{[0, 1, 2].map(n => <Skeleton key={n} className="h-7 w-full" />)}</div><Skeleton className="h-4 w-full" /><Skeleton className="h-36 w-full" /></div>)}</section>
    <Accordion><AccordionItem value="facets"><AccordionTrigger tabIndex={-1}><Skeleton className="h-5 w-44" /></AccordionTrigger><AccordionContent /></AccordionItem></Accordion><Skeleton className="h-20 w-full" />
  </div></div>;
}
