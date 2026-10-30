"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ClipboardList, CircleCheck, Copy, GitCompareArrows, Grid2X2, Info, Search, Flag, SlidersHorizontal, Activity } from "lucide-react";
import { cn } from "cn";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { StateCard } from "@/components/feedback/state-card";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { MovementDate } from "@/features/pipeline-movement/board-states";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { plural } from "@/features/employer-vacancies/plural";
import type { AssessmentResult, ComparedCompetency, Invitation } from "../model";
import { bandLabels, competencyLabels, comparisonLabel, facetLabels, fitLabel, focusMessages, importanceLabels, questionReason, signalReason, statusLabels, tierLabels, tierMessages } from "../labels";
import type { useSheetResult } from "./state";
import { readConsequence } from "./feedback";

type Session = ReturnType<typeof useSheetResult>;
type Presentation = { expanded: boolean; onExpand: () => void; candidateName: string; stageName: string; vacancyTitle?: string; invitationBlock: ReactNode };
const introduction = "Este resultado resume lo que la persona declaró. Confírmalo con ejemplos de trabajo; no demuestra por sí solo cómo trabaja.";
const hypothesis = "Lo declarado y su relación con el puesto son hipótesis, no conductas comprobadas. Confirma con ejemplos de trabajo.";
const sections = [["guide", "Guía"], ["competencies", "Competencias"], ["quality", "Calidad"], ["facets", "Detalle por rasgo"], ["comparisons", "Comparaciones"]] as const;
export function PsychometricPanel({ invitation, session, locked, ...presentation }: { invitation: Invitation; session: Session; locked?: boolean } & Presentation) {
  if (invitation.status !== "finished") return <p className="text-sm text-muted-foreground">{statusLabels[invitation.status]} · {invitation.answered_count} de {invitation.total_count} respuestas</p>;
  if (!session.value) return <ResultSkeleton />;
  if (!session.value.ok) return <StateCard icon={Info} tone="error" title="No pudimos cargar el resultado" description={readConsequence(session.value.reason)} primaryAction={{ label: "Reintentar resultado", onClick: session.retry, "aria-describedby": "psychometric-read-status" }}><ActionStatusSlot><ActionStatus id="psychometric-read-status" tone="error" text="No se cargó el resultado" /></ActionStatusSlot></StateCard>;
  return <StoredResult data={session.value.data} invitation={invitation} session={session} locked={locked} {...presentation} />;
}

/** One installed disclosure composition for every depth level in both modes. */
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return <Accordion><AccordionItem value="detail"><AccordionTrigger>{label}</AccordionTrigger><AccordionContent>{children}</AccordionContent></AccordionItem></Accordion>;
}
function FitBadge({ competency, confirmed }: { competency: ComparedCompetency; confirmed: boolean }) {
  const Icon = competency.fit === "fit.alineado" ? CircleCheck : competency.fit === "fit.atencion" ? Flag : Search;
  return <Badge variant={competency.fit === "fit.alineado" ? "success" : competency.fit ? "accent" : "neutral"}><Icon aria-hidden="true" data-icon="inline-start" />{fitLabel(competency, confirmed)}</Badge>;
}
function BandMatrix({ competency, mini = false }: { competency: ComparedCompetency; mini?: boolean }) {
  const uncompared = competency.importance === "importance.no_relevante";
  return <div role="region" aria-label={`Bandas · ${competencyLabels[competency.competency_id]}`} className={cn("flex min-w-0 flex-col gap-2", mini && "text-xs")}>
    <div className="grid grid-cols-3 gap-1.5 p-1" aria-hidden="true">{(Object.keys(bandLabels) as (keyof typeof bandLabels)[]).map(band => <span key={band} data-desired={band === competency.desired_band} data-obtained={band === competency.band} className={cn("rounded-md bg-muted py-1 text-center text-xs text-muted-foreground", band === competency.band && (uncompared ? "bg-muted-foreground text-card" : "bg-primary text-primary-foreground"), band === competency.desired_band && "outline-2 outline-offset-1 outline-muted-foreground")}>{bandLabels[band]}</span>)}</div>
    <p className={cn("text-xs text-muted-foreground", mini && "sr-only")}>Deseado: {competency.desired_band ? bandLabels[competency.desired_band] : "Sin comparación"} · Obtenido: {bandLabels[competency.band]}</p>
  </div>;
}
function ReportSection({ id, title, meta, icon: Icon, action, footnote, children }: { id: string; title: string; meta: string; icon: typeof Info; action?: ReactNode; footnote?: string; children: ReactNode }) {
  return <section id={`psychometric-${id}`} aria-labelledby={`psychometric-${id}-title`} className="scroll-mt-6"><Card>
    <CardHeader className="border-b"><CardTitle><h3 id={`psychometric-${id}-title`} className="flex items-center gap-3 text-base font-semibold"><Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />{title}</h3></CardTitle><CardDescription className="text-xs">{meta}</CardDescription>{action && <CardAction>{action}</CardAction>}</CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-4">{children}</CardContent>{footnote && <CardFooter className="border-t text-xs leading-5 text-muted-foreground">{footnote}</CardFooter>}
  </Card></section>;
}
function CompetencyRows({ data, compact = false }: { data: AssessmentResult; compact?: boolean }) {
  const comparison = data.latest_comparison;
  function row(c: ComparedCompetency) {
    const interpretation = data.interpretations.find(i => i.competency_id === c.competency_id)!;
    return <section key={c.competency_id} aria-label={competencyLabels[c.competency_id]} className="flex min-w-0 flex-col gap-3 border-b py-3 last:border-0">
      <div className={cn("grid items-center gap-2", compact ? "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_156px_auto]")}>
        <div><h4 className="text-sm font-medium">{competencyLabels[c.competency_id]}</h4><p className="text-xs text-muted-foreground">{importanceLabels[c.importance]}</p></div>
        {compact ? <Badge variant="neutral">{bandLabels[c.band]}</Badge> : <BandMatrix competency={c} />}
        <div className="max-sm:col-span-full"><FitBadge competency={c} confirmed={comparison.profile_version !== null} /></div>
      </div>
      {!compact && <Disclosure label={`Interpretación · ${competencyLabels[c.competency_id]}`}><dl className="grid gap-3 text-sm leading-6">{[["Lectura del resultado", interpretation.intro_text], ["Cómo se puede ver en el trabajo", interpretation.work_text], ["Fortalezas", interpretation.strengths_text], ["Áreas a desarrollar", interpretation.development_text], ["Hipótesis", interpretation.hypothesis_text]].map(([label, text]) => <div key={label} className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4"><dt className="text-xs font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{text}</dd></div>)}</dl></Disclosure>}
    </section>;
  }
  const excluded = comparison.competencies.filter(c => c.importance === "importance.no_relevante");
  return <div className="flex flex-col gap-3">{comparison.competencies.filter(c => c.importance !== "importance.no_relevante").map(row)}{excluded.length > 0 && <Disclosure label={`No relevante · ${plural(excluded.length, "competencia", "competencias")} · ${comparison.profile_version === null ? "sin perfil confirmado" : "No se compara"}`}>{excluded.map(row)}</Disclosure>}</div>;
}
function FocusRows({ data, onNavigate }: { data: AssessmentResult; onNavigate?: (id: string) => void }) {
  const comparison = data.latest_comparison;
  return <section aria-label="Focos para tu entrevista" className="flex flex-col gap-2"><h4 className="text-sm font-semibold">Focos para tu entrevista</h4><p className="text-xs text-muted-foreground">Son temas para profundizar, no motivos automáticos de descarte.</p>
    {comparison.focus_areas.length ? <ul className="flex flex-col">{comparison.focus_areas.map(focus => {
      const competency = focus.type === "focus.quality" ? focus.routed_competency_id : focus.competency_id;
      const question = comparison.guide.find(q => q.competency_id === competency && q.originating_focus_type === focus.type);
      const index = question ? comparison.guide.indexOf(question) + 1 : null;
      return <li key={`${focus.type}-${competency}`} className="flex flex-col gap-1 border-b py-2"><p className="text-xs leading-5 text-muted-foreground">{focusMessages[focus.type]}</p>{question && <a className="inline-flex min-h-10 items-center justify-between gap-2 text-sm underline underline-offset-4" href={`#psychometric-${question.question_id}`} onClick={onNavigate ? event => { event.preventDefault(); onNavigate(`psychometric-${question.question_id}`); } : undefined}>{competencyLabels[competency]} · Pregunta {index}<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></a>}</li>;
    })}</ul> : <p className="text-xs text-muted-foreground">No hay focos almacenados en esta comparación.</p>}
  </section>;
}
function InvitationTimeline({ invitation }: { invitation: Invitation }) {
  const events = [["Invitación creada", invitation.created_at], ["Consentimiento", invitation.consented_at], ["Último recordatorio", invitation.last_reminded_at], ["Finalizada", invitation.finished_at]].filter(([, at]) => at).sort((a, b) => Date.parse(a[1]!) - Date.parse(b[1]!));
  return <ol className="flex list-none flex-col gap-3 border-l border-border pl-4">{events.map(([label, at]) => <li key={label} className="relative text-xs before:absolute before:top-1 before:-left-5 before:size-2 before:rounded-full before:bg-muted-foreground"><p className="font-medium">{label}</p><p className="text-muted-foreground"><MovementDate value={at!} withTime /></p></li>)}</ol>;
}
function StoredResult({ data, invitation, session, locked, expanded, onExpand, candidateName, stageName, vacancyTitle, invitationBlock }: { data: AssessmentResult; invitation: Invitation; session: Session; locked?: boolean } & Presentation) {
  const comparison = data.latest_comparison;
  const [copying, setCopying] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("guide");
  const copyLock = useRef(false);
  const reportScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded && anchor) { document.getElementById(anchor)?.scrollIntoView?.({ block: "start" }); document.getElementById(anchor)?.focus(); setAnchor(null); }
  }, [expanded, anchor]);
  useEffect(() => {
    if (!expanded || !reportScroll.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => { const visible = entries.find(entry => entry.isIntersecting); if (visible) setActiveSection(visible.target.id.replace("psychometric-", "")); }, { root: reportScroll.current, rootMargin: "0px 0px -65% 0px" });
    sections.forEach(([id]) => { const element = document.getElementById(`psychometric-${id}`); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [expanded]);
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
  const outdated = !!currentProfile?.confirmed && currentProfile.version !== comparison.profile_version;
  const compareExplanation = !session.profile?.ok ? "No pudimos consultar el perfil actual. Se conserva la comparación almacenada." : !currentProfile?.confirmed ? "El perfil actual no está confirmado. Se conserva la comparación almacenada." : !outdated ? "El perfil no ha cambiado desde esta comparación. No es necesario volver a comparar." : `El perfil de la vacante cambió. El perfil actual es versión ${currentProfile.version}. Las bandas no cambian y la comparación anterior se conserva.`;
  const copyButton = <Button type="button" variant="outline" className="min-h-10" onClick={() => void copyGuide()} disabled={copying || comparison.guide.length === 0} aria-describedby="psychometric-copy-status"><Copy aria-hidden="true" data-icon="inline-start" />Copiar guía</Button>;
  const copyStatus = <ActionStatusSlot>{copyNotice && <ActionStatus id="psychometric-copy-status" {...copyNotice} />}</ActionStatusSlot>;
  const status = <div className="flex flex-wrap items-center gap-2"><Badge variant="success" dot>Finalizado</Badge><span className="text-xs text-muted-foreground"><MovementDate value={data.finished_at} /></span></div>;
  const fitGroups = [...new Set(comparison.competencies.map(c => fitLabel(c, comparison.profile_version !== null)))];
  const tierChip = <Badge variant={data.quality.tier === "tier.sin" ? "neutral" : "info"}>{tierLabels[data.quality.tier]}</Badge>;
  return <div className={expanded ? "grid h-full min-h-0 min-w-0 grid-cols-1 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden" : "flex min-w-0 flex-col gap-4"} data-pf-psychometric-result="">
    {!expanded ? <>
      <header className="flex flex-col gap-3">{status}<h2 className="text-xl font-semibold">Prepara tu entrevista</h2><p className="text-sm leading-6 text-muted-foreground">{introduction}</p><Button id="psychometric-expand" type="button" className="min-h-10 w-full" onClick={onExpand}>Ver informe completo<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button></header>
      {invitationBlock}<section aria-label="Competencias"><div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold">Competencias</h3><span className="text-xs text-muted-foreground">{comparisonLabel(comparison.profile_version)}</span></div><CompetencyRows data={data} compact /></section>
      <FocusRows data={data} onNavigate={id => { setAnchor(id); onExpand(); }} />
    </> : <>
      <aside aria-label="Preparación del reclutador" className="flex min-w-0 flex-col gap-6 border-b bg-background p-5 [&>*]:shrink-0 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
        <header className="flex items-start gap-3"><Avatar className="size-10 shrink-0"><AvatarFallback>{initials(candidateName)}</AvatarFallback></Avatar><div className="flex min-w-0 flex-col gap-2"><h2 className="text-base font-semibold">{candidateName}</h2><Badge variant="neutral" dot>{stageName}</Badge><p className="text-xs text-muted-foreground">{vacancyTitle}</p></div></header>
        <section aria-label="Panorama" className="flex flex-col gap-3"><div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold">Panorama</h3><span className="text-xs text-muted-foreground">{plural(comparison.competencies.length, "competencia", "competencias")}</span></div><p className="text-xs text-muted-foreground">Contorno: deseado · Relleno: obtenido</p><ul>{comparison.competencies.map(c => <li key={c.competency_id} className="grid grid-cols-[minmax(0,1fr)_156px] items-center gap-2 border-b py-2"><div className={cn("text-xs font-medium", c.importance === "importance.no_relevante" && "text-muted-foreground")}>{competencyLabels[c.competency_id]}{!c.fit && <p className="mt-1 text-xs font-normal text-muted-foreground">{importanceLabels[c.importance]} · {fitLabel(c, comparison.profile_version !== null)}</p>}</div><BandMatrix competency={c} mini /></li>)}</ul>
          <div aria-hidden="true" className="flex gap-1">{comparison.competencies.map(c => <span key={c.competency_id} className={cn("h-1.5 flex-1 rounded-sm", c.fit === "fit.alineado" ? "bg-status-success" : c.fit === "fit.atencion" ? "bg-primary" : c.fit === "fit.explorar" ? "border border-primary bg-primary/12" : "bg-border")} />)}</div><ul aria-label="Distribución por competencia, no puntaje global" className="grid grid-cols-1 gap-2">{fitGroups.map(label => { const group = comparison.competencies.filter(c => fitLabel(c, comparison.profile_version !== null) === label); return <li key={label} className="flex items-center justify-between gap-2"><FitBadge competency={group[0]} confirmed={comparison.profile_version !== null} /><span className="text-xs tabular-nums text-muted-foreground">{group.length}</span></li>; })}</ul>
        </section>
        <Card size="sm"><CardHeader><CardTitle><h3>Guía</h3></CardTitle><CardDescription className="text-xs">{plural(comparison.guide.length, "pregunta", "preguntas")} · {plural(comparison.focus_areas.length, "foco", "focos")}</CardDescription></CardHeader><CardFooter className="flex-col items-stretch">{copyButton}{copyStatus}</CardFooter></Card>
        <section className="flex flex-col gap-3"><h3 className="text-base font-semibold">Comparación guardada</h3><p className="text-xs text-muted-foreground">{comparisonLabel(comparison.profile_version)} · {plural(data.comparisons.length, "comparación", "comparaciones")}</p><Button type="button" variant="outline" className="min-h-10 w-full" disabled={!outdated || locked || session.comparing || session.uncertain} aria-describedby="psychometric-compare-note psychometric-comparison-status" onClick={() => setConfirm(true)}>Comparar con el perfil actual</Button><p id="psychometric-compare-note" className="text-xs leading-5 text-muted-foreground">{compareExplanation}</p><ActionStatusSlot>{session.comparisonNotice && <ActionStatus id="psychometric-comparison-status" {...session.comparisonNotice} />}</ActionStatusSlot><a className="inline-flex min-h-10 items-center gap-2 text-xs underline" href="#psychometric-comparisons">Comparaciones<ArrowRight aria-hidden="true" className="size-4" /></a></section>
        <Separator /><section className="flex flex-col gap-3"><h3 className="text-base font-semibold">Calidad de respuesta</h3>{tierChip}<p className="text-xs leading-5 text-muted-foreground">{tierMessages[data.quality.tier]}</p></section>
        <Separator /><section className="flex flex-col gap-4"><h3 className="text-base font-semibold">Invitación</h3><InvitationTimeline invitation={invitation} />{invitationBlock}</section>
        <Separator /><p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Info aria-hidden="true" className="size-4 shrink-0" />{hypothesis}</p>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        <nav aria-label="Apartados del informe" className="flex shrink-0 gap-2 overflow-x-auto border-b bg-card px-4 py-2">{sections.map(([id, text]) => <a key={id} href={`#psychometric-${id}`} aria-current={activeSection === id ? "location" : undefined} onClick={() => setActiveSection(id)} className={cn(buttonVariants({ variant: "link" }), "min-h-10", activeSection !== id && "text-muted-foreground")}>{text}</a>)}</nav>
        <div ref={reportScroll} tabIndex={0} aria-label="Contenido del informe" className="min-h-0 flex-1 bg-muted p-4 lg:overflow-y-auto lg:p-6"><article className="mx-auto flex max-w-[820px] min-w-0 flex-col gap-6">
          <ReportSection id="guide" title="Guía de entrevista" meta={`${plural(comparison.guide.length, "pregunta del banco redactado", "preguntas del banco redactado")}. Pide contexto, acciones y resultados.`} icon={ClipboardList}>
            <p className="text-xs leading-5 text-muted-foreground">{introduction}</p><FocusRows data={data} />
            <ol className="flex list-none flex-col gap-4">{comparison.guide.map((q, index) => <li key={q.question_id} id={`psychometric-${q.question_id}`} tabIndex={-1} className="scroll-mt-6 outline-none"><Card size="sm"><CardHeader><CardTitle><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{String(index + 1).padStart(2, "0")}</Badge><span className="text-sm">{competencyLabels[q.competency_id]}</span>{q.fit && <FitBadge competency={{ ...comparison.competencies.find(c => c.competency_id === q.competency_id)!, fit: q.fit }} confirmed={comparison.profile_version !== null} />}</div></CardTitle></CardHeader><CardContent className="flex flex-col gap-3"><p className="whitespace-pre-wrap break-words text-sm leading-6">{q.text}</p><p className="text-xs leading-5 text-muted-foreground">Por qué se sugiere: {questionReason(q)}.</p><Disclosure label="Qué escuchar en el ejemplo"><p className="whitespace-pre-wrap break-words">{q.good_answer_checklist}</p></Disclosure></CardContent></Card></li>)}</ol>
            {!comparison.guide.length && <p className="text-sm text-muted-foreground">No hay preguntas almacenadas para esta comparación.</p>}
          </ReportSection>
          <ReportSection id="competencies" title="Competencias" meta="El puesto y sus respuestas" icon={SlidersHorizontal}><p className="text-xs leading-5 text-muted-foreground">Bandas por significado, no percentiles. Ninguna banda es intrínsecamente mejor. Contorno: deseado · Relleno: obtenido.</p><CompetencyRows data={data} /></ReportSection>
          <ReportSection id="quality" title="Cómo se respondió" meta="Contexto de respuesta" icon={Activity} action={tierChip} footnote="Estas señales no prueban una intención ni cambian las bandas de personalidad."><p className="text-sm leading-6">{tierMessages[data.quality.tier]}</p>{data.quality.partial && <p className="text-sm text-muted-foreground">Información parcial: no se registraron todos los tiempos o cambios de respuesta.</p>}<ul>{[...data.quality.signals].sort((a, b) => ["signal.attention", "signal.long_string", "signal.fast", "signal.changes"].indexOf(a.id) - ["signal.attention", "signal.long_string", "signal.fast", "signal.changes"].indexOf(b.id)).map(signal => { const reason = signalReason(signal); return reason ? <li key={signal.id} className="flex items-start gap-3 border-t py-4 text-sm leading-6"><Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /><p>{reason}</p></li> : null; })}</ul></ReportSection>
          <ReportSection id="facets" title="Detalle por rasgo" meta="Bandas de las respuestas, no diagnósticos." icon={Grid2X2}><Disclosure label="Mostrar las 15 facetas"><section aria-label="Bandas por rasgo"><dl className="grid gap-x-6 sm:grid-cols-2">{data.facets.map(facet => <div key={facet.facet_id} className="flex justify-between gap-3 border-b py-2 text-xs"><dt>{facetLabels[facet.facet_id]}</dt><dd className="text-muted-foreground">{bandLabels[facet.band]}</dd></div>)}</dl></section></Disclosure></ReportSection>
          <ReportSection id="comparisons" title="Comparación con la vacante" meta={comparisonLabel(comparison.profile_version)} icon={GitCompareArrows} footnote="Se guardará una nueva comparación y guía. Las bandas originales y el historial no cambian. Requiere confirmación."><p className="text-xs text-muted-foreground"><MovementDate value={comparison.created_at} /> · {plural(data.comparisons.length, "comparación guardada", "comparaciones guardadas")}</p><h4 className="text-sm font-medium">Comparaciones anteriores</h4><ol className="flex list-none flex-col gap-4 border-l pl-4">{data.comparisons.map(c => <li key={c.id} className="relative text-xs text-muted-foreground before:absolute before:top-1 before:-left-5 before:size-2 before:rounded-full before:bg-muted-foreground">{comparisonLabel(c.profile_version)} · {c.id === comparison.id ? "comparación actual" : "comparación anterior"}</li>)}</ol></ReportSection>
          <p className="text-xs leading-5 text-muted-foreground">Úsalo para preparar la entrevista. La decisión requiere evidencia adicional y revisión humana.</p>
        </article></div>
      </div>
    </>}
    <ConfirmActionDialog icon={GitCompareArrows} open={confirm} onOpenChange={setConfirm} title="¿Comparar con el perfil actual?" description="Se guardará una nueva comparación y guía. Las bandas originales y el historial no cambian." confirmLabel="Comparar" pendingLabel="Comparando…" pending={session.comparing} onConfirm={() => { void session.compare().then(() => setConfirm(false)); }} />
  </div>;
}

/** Compact loading state: result counts and eligibility are unknown until the audited read. */
export function ResultSkeleton() {
  return <div data-pf-result-skeleton="" aria-busy="true" className="flex flex-col gap-4"><span role="status" className="sr-only">Cargando resultado psicométrico</span><div aria-hidden="true" className="flex flex-col gap-4"><Skeleton className="h-5 w-32" /><Skeleton className="h-7 w-56" /><Skeleton className="h-16 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-20 w-full" />{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div></div>;
}
