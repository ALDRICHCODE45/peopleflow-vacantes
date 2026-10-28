"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpRight, CalendarDays, Check, CircleMinus, Clock3, FileText, FileType2, Globe2, GraduationCap, Info, Languages, Mail, MapPin, Phone, Sparkles, BriefcaseBusiness, RotateCcw, TrendingUp, UserRoundX, X } from "lucide-react";
import { cn } from "cn";
import { ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DocumentItem } from "@/components/document/document-item";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { StateCard } from "@/components/feedback/state-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadHistoryAction, loadParticipationAction } from "./actions";
import { MovementDate } from "./board-states";
import { CandidateMenu } from "./candidate-menu";
import { SubstateSelect } from "./substate-controls";
import { discardGroupLabel, discardReasonLabel } from "./discard-text";
import { allowedMoveTargets } from "./helpers";
import { participationCvHref } from "./cv-href";
import { filePresentation, Hint, initials, stageClass } from "./pipeline-presentation";
import type { Notice } from "./board-feedback";
import { plural } from "@/features/employer-vacancies/plural";
import { educationLabels, normalizedProfileLabel } from "./profile-filter-dimensions";
import { SENIORITY_LABELS } from "@/features/candidate/model";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { useBoardChecklist } from "@/features/vacancy-checklist/board/state";
import { ChecklistPanel } from "@/features/vacancy-checklist/board/ui";
import type { Board, CorrectedField, Failure, History, Participation, ParticipationDetail } from "./model";

type Props = { vacancyId: string; vacancyTitle?: string; item: Participation; board: Board; onClose: () => void; onSubstate?: (id: string, substateId: string | null) => void; onMove?: (id: string, target: string) => void; onDisposition?: (id: string, kind: "discard" | "recover") => void; locked?: boolean; notice?: Notice; children?: ReactNode };
export function CandidateSheet(props: Props) {
  return <Sheet open onOpenChange={open => { if (!open) props.onClose(); }}><CandidateSession key={props.item.id} {...props} /></Sheet>;
}
function CandidateSession({ vacancyId, vacancyTitle, item, board, onClose, onMove, onDisposition, onSubstate, locked, notice: actionNotice, children }: Props) {
  const checklist = useBoardChecklist();
  const manual = item.source === "manual";
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [tab, setTab] = useState("summary");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ detail: ParticipationDetail; history: History } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reading, setReading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    let current = true;
    async function load() {
      setReading(true);
      let result;
      try {
        const [detail, history] = await Promise.all([loadParticipationAction(vacancyId, item.id), loadHistoryAction(vacancyId, item.id)]);
        result = !detail.ok ? detail : !history.ok ? history : { ok: true, data: { detail: detail.data, history: history.data } } as const;
      } catch { result = { ok: false, reason: "no_response", reference: {} } as const; }
      if (!current) return;
      setReading(false);
      if (result.ok) { setLoaded(result.data); setFailure(null); }
      else setFailure(result);
      if (attempt > 0) {
        const next: Notice = result.ok ? { tone: "info", text: "Detalle actualizado" } : { tone: "error", text: "No pudimos cargar el detalle" };
        setNotice(next);
        notifyActionResult({ key: "pipeline-detail-read", type: next.tone, title: next.text,
          description: result.ok ? "Las respuestas y el historial están actualizados." : "No se modificó ningún candidato. Es seguro volver a cargar el detalle.",
          ...(!result.ok ? { reference: { ...result.reference, at: new Date().toISOString() } } : {}) });
      }
    }
    void load(); return () => { current = false; };
  }, [vacancyId, item.id, item.etag, attempt]);
  const stages = [...board.stages, board.exit, ...board.retired_stages];
  const stageName = (id: string) => stages.find(stage => stage.id === id)?.name ?? "Columna eliminada";
  // The board's confirmed item owns live state while the detail/history read refreshes.
  const detail = loaded?.detail ?? item;
  const stage = stages.find(stage => stage.id === item.stage_id);
  const FileIcon = filePresentation(detail.cv.name) === "pdf" ? FileText : FileType2;
  const events = loaded ? [...loaded.history.items].reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : [];
  const errorNotice = actionNotice?.tone !== "success" ? actionNotice : undefined;
  return <SheetContent showCloseButton={false} initialFocus={titleRef} className="pf-candidate-sheet gap-0 bg-card data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]" finalFocus={() => document.getElementById(`candidate-detail-${item.id}`) ?? document.getElementById("board-substate-filter")}>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6">
      <span className="flex items-center gap-2 text-xs text-muted-foreground"><span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground" />Ficha del candidato</span>
      <Hint text="Cerrar ficha"><Button type="button" variant="ghost" size="icon" className="size-10" aria-label="Cerrar ficha" onClick={onClose}><X aria-hidden="true" /></Button></Hint>
    </div>
    <SheetHeader className="gap-4">
      <div className="flex items-center gap-3"><Avatar className="size-12 shrink-0"><AvatarFallback className="bg-secondary text-lg text-muted-foreground">{initials(detail.candidate.full_name)}</AvatarFallback></Avatar>
        <div className="flex min-w-0 flex-col gap-1.5"><div className="flex min-w-0 flex-wrap items-center gap-2"><SheetTitle ref={titleRef} tabIndex={-1} title={detail.candidate.full_name} className="min-w-0 break-words text-lg font-semibold outline-none">{detail.candidate.full_name}</SheetTitle>{detail.corrected_fields.includes("full_name") && <Badge variant="accent">Corregido</Badge>}</div>
          {stage && <Badge variant="neutral" dot className={cn("stage-badge max-w-full", stageClass(stage.kind))}><span className="truncate">{stage.name}</span></Badge>}
        </div>
      </div>
      {manual && <Badge variant="accent">Ingreso manual</Badge>}
      <SheetDescription className="text-xs">{manual ? <>Agregado{detail.added_by ? ` por ${detail.added_by.name}` : ""} el <MovementDate value={detail.applied_at} /></> : <>Postuló el <MovementDate value={detail.applied_at} /> <span className="px-1">·</span> Fuente: Orgánica</>}</SheetDescription>
      {/* Evaluation context and its action stay together above the scrolling tabs. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:flex-wrap">
        {onMove && !item.discard && <CandidateMenu item={item} targets={allowedMoveTargets(board, item)} full disabled={locked} onMove={onMove} onDetail={() => {}} onDisposition={onDisposition ?? (() => {})} />}
        {onSubstate && <SubstateSelect board={board} item={item} onChange={onSubstate} disabled={locked} describedBy={errorNotice ? "detail-action-status" : undefined} />}
        {onDisposition && <Button id={`candidate-disposition-${item.id}`} type="button" variant="outline" className={cn("h-10", !item.discard && "border-destructive/25 text-destructive")} disabled={locked} aria-label={item.discard ? "Recuperar" : "Descartar"} aria-describedby={errorNotice ? "detail-action-status" : undefined} onClick={() => onDisposition(item.id, item.discard ? "recover" : "discard")}>
          {item.discard ? <RotateCcw aria-hidden="true" data-icon="inline-start" /> : <UserRoundX aria-hidden="true" data-icon="inline-start" />}{item.discard ? "Recuperar" : "Descartar"}
        </Button>}
      </div>
      {errorNotice && <ActionStatus id="detail-action-status" tone={errorNotice.tone} text={errorNotice.text} />}
    </SheetHeader>
    <Tabs value={tab} onValueChange={value => setTab(String(value))} className="min-h-0 flex-1 gap-0">
      <div className="px-6 pb-5"><TabsList aria-label="Secciones de la ficha" className="w-full group-data-horizontal/tabs:h-11">
        <TabsTrigger value="summary">Resumen</TabsTrigger>
        <TabsTrigger value="answers">Respuestas <Badge variant="secondary">{loaded?.detail.screening.length ?? "…"}</Badge></TabsTrigger>
        {checklist?.checklist?.criteria.length ? <TabsTrigger value="checklist">Checklist</TabsTrigger> : null}
        <TabsTrigger value="history">Historial <Badge variant="secondary">{loaded?.history.items.length ?? "…"}</Badge></TabsTrigger>
      </TabsList></div><Separator />
      <ScrollArea className="pf-sheet-scroll min-h-0 flex-1" key={tab}>
        <TabsContent value={tab} className="p-6" aria-busy={reading}>
          {tab === "checklist" ? <ChecklistPanel item={item} /> : reading ? <><span role="status" className="sr-only">Cargando detalle e historial</span><CandidateDetailSkeleton tab={tab} discarded={!!item.discard} answerCount={loaded?.detail.screening.length} historyCount={loaded?.history.items.length} /></> : failure ? <StateCard icon={Info} tone="error" title="No pudimos cargar el detalle"
            description={failure.reason === "unauthenticated" ? "Tu sesión expiró. No se modificó el candidato; inicia sesión de nuevo." : "No se modificó el candidato. Puedes volver a cargar las respuestas y el historial."}
            primaryAction={{ label: "Reintentar", disabled: reading, "aria-describedby": notice ? "detail-read-status" : undefined, onClick: () => { setReading(true); setNotice(null); setAttempt(value => value + 1); } }}>
            {notice && <ActionStatus id="detail-read-status" tone={notice.tone} text={notice.text} />}
          </StateCard> : loaded && <>
            {tab === "summary" && <div className="flex flex-col gap-7">
              <section className="flex flex-col gap-5"><SectionTitle>{manual ? "Información del ingreso" : "Información de la postulación"}</SectionTitle>
                <dl className="grid grid-cols-2 items-center gap-x-4 gap-y-5">
                  <dt className="flex items-center gap-2 text-xs text-muted-foreground"><ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />Etapa actual</dt><dd className="break-words text-sm font-medium">{stageName(item.stage_id)}</dd>
                  <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 aria-hidden="true" className="size-4 shrink-0" />En la etapa desde</dt><dd className="text-sm font-medium tabular-nums"><MovementDate value={item.moved_at} /></dd>
                  <dt className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-4 shrink-0" />{manual ? "Ingreso" : "Postulación"}</dt><dd className="text-sm font-medium tabular-nums"><MovementDate value={detail.applied_at} /></dd>
                  <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Globe2 aria-hidden="true" className="size-4 shrink-0" />Fuente</dt><dd className="text-sm font-medium">{manual ? "Ingreso manual" : "Orgánica"}</dd>
                </dl>
              </section><Separator />
              <CandidateContact contact={loaded.detail.contact} correctedFields={loaded.detail.corrected_fields} /><Separator />
              <CandidateProfile profile={loaded.detail.profile} manual={manual} correctedFields={loaded.detail.corrected_fields} /><Separator />
              <section className="flex flex-col gap-3"><SectionTitle>CV</SectionTitle><DocumentItem icon={FileIcon} title={detail.cv.name}
                description={filePresentation(detail.cv.name) === "pdf" ? "Documento PDF" : "Documento Word"} badge={detail.cv.source === "company" && <Badge variant="accent">CV corregido por tu empresa</Badge>}
                actions={<>
                  <Button variant="outline" size="sm" className="min-h-10" nativeButton={false} render={<a href={participationCvHref(vacancyId, item.id)} download role="link" />}><ArrowDownToLine aria-hidden="true" data-icon="inline-start" />Descargar CV</Button>
                  {detail.cv.source === "company" && loaded.detail.original_cv && <Button variant="outline" size="sm" className="min-h-10" nativeButton={false} render={<a href={participationCvHref(vacancyId, item.id, "original")} download role="link" />}><ArrowDownToLine aria-hidden="true" data-icon="inline-start" />Descargar CV original</Button>}
                </>} /></section>
              {loaded.detail.discard && <Card size="sm" className="bg-status-danger/10"><CardHeader><CardTitle><SectionTitle>Descarte</SectionTitle></CardTitle><CardDescription><p className="text-sm font-medium text-status-danger">{discardReasonLabel(loaded.detail.discard.reason)}</p><p className="text-xs">{discardGroupLabel(loaded.detail.discard.reason)}</p></CardDescription></CardHeader>
                <CardContent className="flex flex-col gap-4"><p className="text-xs text-muted-foreground">Etapa anterior: <strong className="text-foreground">{stageName(loaded.detail.discard.previous_stage_id)}</strong></p>
                <DiscardNotes comment={loaded.detail.comment} message={loaded.detail.candidate_message} showEmpty /></CardContent>
                <CardFooter><p className="text-xs text-muted-foreground">{manual ? "Este registro es interno; no se envían avisos al candidato." : "El candidato ve este mensaje con el estado Finalizada."}</p></CardFooter>
              </Card>}
              <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Esta información es visible únicamente para tu equipo de reclutamiento.</p>
            </div>}
            {tab === "answers" && <section className="flex flex-col gap-6"><SectionTitle>Preguntas de filtro</SectionTitle>
              {loaded.detail.screening.length ? <dl className="flex flex-col gap-6">{loaded.detail.screening.map(answer => <div key={answer.question_id} className="flex flex-col gap-2 border-b pb-5"><dt className="break-words text-[13px] text-muted-foreground">{answer.prompt}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-6">{answer.type === "open" ? answer.answer.text : answer.answer.label}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">No hay respuestas a preguntas de filtro.</p>}
            </section>}
            {tab === "history" && <section className="flex flex-col gap-6"><SectionTitle>{manual ? "Actividad del candidato" : "Actividad de la postulación"}</SectionTitle>
              {events.length ? <ol>{events.map((entry, index) => <li key={`${entry.at}-${index}`} className="relative flex gap-4 pb-7 last:pb-0">
                <div className="flex flex-col items-center"><span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", entry.kind === "not_applicable" ? "bg-muted text-muted-foreground" : entry.kind === "discard" ? "bg-status-danger/10 text-status-danger" : entry.kind === "recovery" ? "bg-status-info/10 text-status-info" : "bg-status-success/10 text-status-success")}>{entry.kind === "not_applicable" ? <CircleMinus aria-hidden="true" className="size-3" /> : entry.kind === "recovery" ? <RotateCcw aria-hidden="true" className="size-3" /> : entry.kind === "discard" ? <UserRoundX aria-hidden="true" className="size-3" /> : <Check aria-hidden="true" className="size-3" />}</span>{index < events.length - 1 && <span aria-hidden="true" className="w-px flex-1 bg-border" />}</div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="break-words text-sm font-medium">{entry.kind === "not_applicable" ? `No aplica por cambio de proceso · ${stageName(entry.stage_id)}` : entry.kind === "intake" ? (manual ? "Ingreso manual" : "Postulación recibida") : entry.kind === "discard" ? "Descarte" : entry.kind === "recovery" ? "Recuperación" : entry.kind === "substate" ? `Subestado: ${entry.from_substate_name ?? "Sin subestado"} → ${entry.to_substate_name ?? "Sin subestado"}` : `${entry.from_stage_id ? stageName(entry.from_stage_id) : "Etapa no disponible"} → ${stageName(entry.to_stage_id)}`}</p>
                  {(entry.kind === "discard" || entry.kind === "recovery") && <p className="text-xs text-muted-foreground">{stageName(entry.from_stage_id)} → {stageName(entry.to_stage_id)}</p>}
                  {entry.kind === "discard" && <><p className="text-sm">{discardGroupLabel(entry.reason)} · {discardReasonLabel(entry.reason)}</p><DiscardNotes comment={entry.comment} message={entry.candidate_message} /></>}
                  {entry.kind === "intake" && <p className="text-xs text-muted-foreground">Ingreso a {stageName(entry.to_stage_id)}</p>}
                  {entry.kind !== "substate" && entry.kind !== "not_applicable" && (entry.hire || entry.departure) && <div className="flex flex-wrap gap-2">{entry.hire && <Badge variant="success">Contratación</Badge>}{entry.departure && <Badge variant="review">Salida de Placement</Badge>}</div>}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><Avatar className="size-5 shrink-0"><AvatarFallback className="text-[9px]">{initials(entry.actor.full_name)}</AvatarFallback></Avatar><span>{entry.actor.full_name} · {entry.actor.kind === "candidate" ? "Candidato" : "Reclutador"}</span></div>
                  <p className="text-xs tabular-nums text-muted-foreground"><MovementDate value={entry.at} withTime /></p>
                </div>
              </li>)}</ol> : <p className="text-sm text-muted-foreground">No hay movimientos registrados.</p>}
            </section>}
          </>}
        </TabsContent>
      </ScrollArea>
    </Tabs>
    <SheetFooter className="border-t py-4 text-xs text-muted-foreground"><span className="truncate">{vacancyTitle}</span></SheetFooter>
    {children}
  </SheetContent>;
}
// Skeleton exception: each tab mirrors its real section/list anatomy instead of generic blocks.
export function CandidateDetailSkeleton({ tab, discarded, answerCount = 2, historyCount = 1 }: { tab: string; discarded: boolean; answerCount?: number; historyCount?: number }) {
  if (tab === "answers") return <section aria-hidden="true" data-pf-detail-skeleton="answers" className="flex flex-col gap-6"><Skeleton className="h-4 w-36" />{answerCount ? <dl className="flex flex-col gap-6">{Array.from({ length: answerCount }, (_, index) => <div key={index} className="flex flex-col gap-2 border-b pb-5"><dt><Skeleton className="h-5 w-48 max-w-full" /></dt><dd><Skeleton className="h-6 w-full" /></dd></div>)}</dl> : <Skeleton className="h-5 w-64 max-w-full" />}</section>;
  if (tab === "history") return <section aria-hidden="true" data-pf-detail-skeleton="history" className="flex flex-col gap-6"><Skeleton className="h-4 w-44" />{historyCount ? <ol>{Array.from({ length: historyCount }, (_, index) => <li key={index} className="relative flex gap-4 pb-7 last:pb-0"><div className="flex flex-col items-center"><Skeleton className="size-6 rounded-full" />{index < historyCount - 1 && <span className="w-px flex-1 bg-border" />}</div><div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-32" /><div className="flex items-center gap-2"><Avatar className="size-5 shrink-0"><AvatarFallback><Skeleton className="size-5 rounded-full" /></AvatarFallback></Avatar><Skeleton className="h-4 w-44 max-w-full" /></div><Skeleton className="h-4 w-32" /></div></li>)}</ol> : <Skeleton className="h-5 w-64 max-w-full" />}</section>;
  return <div aria-hidden="true" data-pf-detail-skeleton="summary" className="flex flex-col gap-7">
    <section className="flex flex-col gap-5"><Skeleton className="h-4 w-56 max-w-full" /><dl className="grid grid-cols-2 items-center gap-x-4 gap-y-5">{[0, 1, 2, 3].map(index => <div key={index} className="contents"><dt className="flex items-center gap-2"><Skeleton className="size-4 shrink-0" /><Skeleton className="h-4 w-24 max-w-full" /></dt><dd><Skeleton className="h-5 w-28 max-w-full" /></dd></div>)}</dl></section>
    <Separator />
    <section className="flex flex-col gap-5"><Skeleton className="h-4 w-16" /><dl className="grid grid-cols-2 items-center gap-x-4 gap-y-5">{[0, 1].map(index => <div key={index} className="contents"><dt className="flex items-center gap-2"><Skeleton className="size-4 shrink-0" /><Skeleton className="h-4 w-24 max-w-full" /></dt><dd><Skeleton className="h-5 w-28 max-w-full" /></dd></div>)}</dl><Skeleton className="h-4 w-56 max-w-full" /></section>
    <Separator />
    <section className="flex flex-col gap-5"><Skeleton className="h-4 w-16" /><dl className="grid grid-cols-2 items-center gap-x-4 gap-y-5">{[0, 1, 2, 3, 4, 5].map(index => <div key={index} className="contents"><dt className="flex items-center gap-2"><Skeleton className="size-4 shrink-0" /><Skeleton className="h-4 w-24 max-w-full" /></dt><dd><Skeleton className="h-5 w-28 max-w-full" /></dd></div>)}</dl><Skeleton className="h-4 w-56 max-w-full" /></section>
    <Separator />
    <section className="flex flex-col gap-3"><Skeleton className="h-4 w-6" /><Item variant="outline" size="sm"><ItemMedia variant="icon"><Skeleton className="size-4" /></ItemMedia><ItemContent className="min-w-0"><ItemTitle><Skeleton className="h-5 w-32" /></ItemTitle><Skeleton className="h-5 w-28"><ItemDescription className="invisible">&nbsp;</ItemDescription></Skeleton></ItemContent><ItemActions className="flex-wrap"><Skeleton className="h-10 w-32" /></ItemActions></Item></section>
    {discarded && <Card size="sm" className="bg-status-danger/10"><CardHeader><CardTitle><Skeleton className="h-4 w-20" /></CardTitle><CardDescription><Skeleton className="h-5 w-44" /><Skeleton className="h-4 w-32" /></CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><Skeleton className="h-4 w-40" /><dl className="flex flex-col gap-4">{[0, 1].map(index => <div key={index} className="flex flex-col gap-1"><dt><Skeleton className="h-4 w-32" /></dt><dd><Skeleton className="h-5 w-full" /></dd></div>)}</dl></CardContent><CardFooter><Skeleton className="h-8 w-full" /></CardFooter></Card>}
    <Skeleton className="h-16 w-full rounded-lg" />
  </div>;
}
function CandidateProfile({ profile, manual, correctedFields }: { profile: Participation["profile"]; manual: boolean; correctedFields: CorrectedField[] }) {
  const catalog = useLanguageCatalog();
  const education = [profile.education.highest_completed && educationLabels[profile.education.highest_completed], profile.education.in_progress && `${educationLabels[profile.education.in_progress]} en curso`].filter(Boolean).join(" · ");
  // One pill per language («Inglés B2»), like skills; a joined string made the levels ambiguous.
  const languages = profile.languages.length ? <div className="flex flex-wrap gap-2">{profile.languages.map(language => <Badge key={language.code} variant="outline">{`${catalog.data?.items.find(item => item.code === language.code)?.name ?? "Idioma no disponible"} ${language.level === "native" ? "Nativo" : language.level}`}</Badge>)}</div> : null;
  const missing = <span className="text-muted-foreground">Sin dato</span>;
  const skills = profile.skills.filter(skill => normalizedProfileLabel(skill));
  const rows: { field: CorrectedField; label: string; icon: typeof Mail; value: ReactNode }[] = [
    { field: "location", label: "Ubicación", icon: MapPin, value: profile.location?.label ?? missing },
    { field: "skills", label: "Habilidades", icon: Sparkles, value: skills.length ? <div className="flex flex-wrap gap-2">{skills.map((skill, index) => <Badge key={index} variant="outline">{skill}</Badge>)}</div> : missing },
    { field: "years_of_experience", label: "Años de experiencia", icon: BriefcaseBusiness, value: profile.years_of_experience === null ? missing : plural(Number(profile.years_of_experience), "año", "años") },
    { field: "seniority", label: "Seniority", icon: TrendingUp, value: profile.seniority === null ? missing : SENIORITY_LABELS[profile.seniority] },
    { field: "education", label: "Nivel de estudios", icon: GraduationCap, value: education || missing },
    { field: "languages", label: "Idiomas", icon: Languages, value: languages || missing },
  ];
  return <section aria-label="Perfil" className="flex flex-col gap-5"><SectionTitle>Perfil</SectionTitle>
    <dl className="grid grid-cols-2 items-center gap-x-4 gap-y-5">{rows.map(({ field, label, icon: Icon, value }) => <div key={label} className="contents">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{label}</dt><dd className="min-w-0 break-words text-sm font-medium"><CorrectedValue corrected={correctedFields.includes(field)}>{value}</CorrectedValue></dd>
    </div>)}</dl>
    <p className="text-xs text-muted-foreground">{rows.some(row => correctedFields.includes(row.field)) ? "Incluye correcciones de tu empresa." : manual ? "Registrado al agregar al candidato." : "Copiado del perfil al postularse."}</p>
  </section>;
}
/** E.164 for display: «+52 55 1234 5678» for Mexico; anything else (other countries, or the free-text
 * phone of organic profiles) stays as written. The tel: link keeps only digits and «+». */
function displayPhone(phone: string) {
  const mx = /^\+52(\d{2})(\d{4})(\d{4})$/.exec(phone);
  return mx ? `+52 ${mx[1]} ${mx[2]} ${mx[3]}` : phone;
}
/** Narrow sheets: let a long address wrap after «@» instead of mid-word. */
function emailWithBreak(email: string) {
  const at = email.lastIndexOf("@");
  return at < 0 ? email : <>{email.slice(0, at + 1)}<wbr />{email.slice(at + 1)}</>;
}
function CandidateContact({ contact, correctedFields }: { contact: ParticipationDetail["contact"]; correctedFields: CorrectedField[] }) {
  const missing = <span className="text-muted-foreground">Sin dato</span>;
  const rows: { field: CorrectedField; label: string; icon: typeof Mail; value: ReactNode }[] = [
    { field: "email", label: "Correo", icon: Mail, value: contact.email ? <a className="underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground" href={`mailto:${contact.email}`} aria-label={contact.email}>{emailWithBreak(contact.email)}</a> : missing },
    { field: "phone", label: "Teléfono", icon: Phone, value: contact.phone ? <a className="tabular-nums underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{displayPhone(contact.phone)}</a> : missing },
  ];
  return <section aria-label="Contacto" className="flex flex-col gap-5"><SectionTitle>Contacto</SectionTitle>
    <dl className="grid grid-cols-2 items-center gap-x-4 gap-y-5">{rows.map(({ field, label, icon: Icon, value }) => <div key={label} className="contents">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{label}</dt><dd className="min-w-0 break-words text-sm font-medium"><CorrectedValue corrected={correctedFields.includes(field)}>{value}</CorrectedValue></dd>
    </div>)}</dl>
  </section>;
}
function CorrectedValue({ corrected, children }: { corrected: boolean; children: ReactNode }) {
  return corrected ? <div className="flex min-w-0 flex-wrap items-center gap-2">{children}<Badge variant="accent">Corregido</Badge></div> : children;
}
function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{children}</h3>;
}
function DiscardNotes({ comment, message, showEmpty = false }: { comment: string | null; message: string | null; showEmpty?: boolean }) {
  return <dl className="flex flex-col gap-4 text-sm">
    {(comment !== null || showEmpty) && <div className="flex flex-col gap-1"><dt className="text-xs text-muted-foreground">Comentario interno</dt><dd className="whitespace-pre-wrap break-words">{comment ?? "Sin comentario interno"}</dd></div>}
    {(message !== null || showEmpty) && <div className="flex flex-col gap-1"><dt className="text-xs text-muted-foreground">Mensaje para el candidato</dt><dd className="whitespace-pre-wrap break-words">{message ?? "Sin mensaje"}</dd></div>}
  </dl>;
}
