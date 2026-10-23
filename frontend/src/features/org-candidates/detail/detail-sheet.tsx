"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, Check, Clock3, GraduationCap, Info, Languages, Link, Mail, MapPin, Pencil, Phone, ShieldCheck, TrendingUp, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StateCard } from "@/components/feedback/state-card";
import { MovementDate } from "@/features/pipeline-movement/board-states";
import { discardReasonLabel } from "@/features/pipeline-movement/discard-text";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { educationLabels, normalizedProfileLabel } from "@/features/pipeline-movement/profile-filter-dimensions";
import { plural } from "@/features/employer-vacancies/pipeline-board";
import { SENIORITY_LABELS } from "@/features/candidate/model";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { CandidateEditForm, type CandidateEditFormHandle } from "@/features/org-candidates/edit/candidate-edit-form";
import type { CandidateEditField } from "@/features/org-candidates/edit/edit-model";
import { ChangeHistory } from "@/features/org-candidates/history/change-history";
import { loadOrgCandidateDetailAction } from "./detail-actions";
import type { DetailResult, OrgCandidateDetail, OrgCandidateIdentity, OrgCandidateParticipation } from "./detail-model";
import { CvConfirmationDialog, ParticipationCv, type CvConfirmation } from "../cv/participation-cv";

type Props = { candidate: OrgCandidateIdentity | null; onOpenChange: (open: boolean) => void; onCandidateUpdated?: (detail: OrgCandidateDetail) => void };
type DetailSessionHandle = { requestClose: () => boolean };
/** sheet-demo composition, controlled without Trigger because either list view opens the same sheet.
 * Like the board: one Spanish close, title focus, fixed identity, one scrolling body.
 */
export function OrgCandidateDetailSheet({ candidate, onOpenChange, onCandidateUpdated }: Props) {
  const sessionRef = useRef<DetailSessionHandle>(null);
  const [cvBusy, setCvBusy] = useState(false);
  const [cvConfirmation, setCvConfirmation] = useState<CvConfirmation | null>(null);
  useEffect(() => { setCvConfirmation(null); setCvBusy(false); }, [candidate?.kind, candidate?.id]);
  return <><Sheet open={candidate !== null} onOpenChange={(open, event) => {
    if (!open && (cvBusy || cvConfirmation)) { event.cancel(); return; }
    if (!open && sessionRef.current?.requestClose()) { event.cancel(); return; }
    onOpenChange(open);
  }}>
    {candidate && <DetailSession ref={sessionRef} key={`${candidate.kind}:${candidate.id}`} candidate={candidate} onCandidateUpdated={onCandidateUpdated} busy={cvBusy} onBusyChange={setCvBusy} onConfirmationChange={setCvConfirmation} />}
  </Sheet><CvConfirmationDialog confirmation={cvConfirmation} pending={cvBusy} onClose={() => setCvConfirmation(null)} /></>;
}
const DetailSession = forwardRef<DetailSessionHandle, { candidate: OrgCandidateIdentity; onCandidateUpdated?: Props["onCandidateUpdated"] } & Pick<CvCallbacks, "busy" | "onBusyChange" | "onConfirmationChange">>(function DetailSession({ candidate: { kind, id }, onCandidateUpdated, busy, onBusyChange, onConfirmationChange }, ref) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<CandidateEditFormHandle>(null);
  const alive = useRef(true);
  const conflictRead = useRef(0);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("summary");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const [result, setResult] = useState<DetailResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  useImperativeHandle(ref, () => ({ requestClose: () => {
    if (!editing) return false;
    formRef.current?.requestClose();
    return true;
  } }));
  useEffect(() => { alive.current = true; return () => { alive.current = false; conflictRead.current++; }; }, []);
  function readView() {
    setEditing(false);
    setTab("summary");
    requestAnimationFrame(() => { if (alive.current) editButtonRef.current?.focus(); });
  }
  async function refreshConflict() {
    const request = ++conflictRead.current;
    const fresh = await loadOrgCandidateDetailAction({ kind, id });
    if (!alive.current || request !== conflictRead.current) return;
    if (!fresh.ok) throw new Error("No se pudo actualizar la ficha");
    // Never clear the current detail: the mounted editor rebases its own draft.
    setResult(fresh);
  }
  function cvSaved(detail: OrgCandidateDetail) {
    if (!alive.current) return;
    conflictRead.current++;
    setResult({ ok: true, data: detail });
    setHistoryRefreshKey(value => value + 1);
    onCandidateUpdated?.(detail);
  }
  function saved(detail: OrgCandidateDetail) {
    cvSaved(detail);
    readView();
  }
  useEffect(() => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }, []);
  useEffect(() => {
    let current = true;
    async function load() {
      let next: DetailResult;
      try { next = await loadOrgCandidateDetailAction({ kind, id }); }
      catch { next = { ok: false, reason: "no_response", reference: {} }; }
      if (current) setResult(next);
    }
    void load();
    return () => { current = false; };
  }, [kind, id, attempt]); // Identity values, not parent object identity, own this read.
  const data = result?.ok ? result.data : null;
  return <SheetContent side="right" showCloseButton={false} initialFocus={titleRef} finalFocus={() => openerRef.current}
    className="gap-0 bg-card max-sm:[--sheet-inset:0px] max-sm:data-[side=right]:rounded-none max-sm:data-[side=right]:border-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[570px]">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-6 py-3">
      <span className="text-xs text-muted-foreground">{editing ? "Editar datos" : "Ficha del candidato"}</span>
      <SheetClose render={<Button type="button" variant="ghost" size="icon" className="min-h-10 min-w-10" aria-label="Cerrar ficha" />}><X aria-hidden="true" /></SheetClose>
    </div>
    <SheetHeader className="gap-4">
      <div className="flex items-start gap-3.5">
        <Avatar className="size-12 shrink-0"><AvatarFallback>{data ? initials(data.full_name) : <Skeleton aria-hidden="true" className="size-12 rounded-full" />}</AvatarFallback></Avatar>
        <div className="flex min-w-0 flex-col gap-1.5">
          <SheetTitle ref={titleRef} tabIndex={-1} className="break-words text-xl font-semibold tracking-tight outline-none">{data?.full_name ?? <span className={result === null ? "sr-only" : undefined}>Detalle del candidato</span>}{result === null && <Skeleton aria-hidden="true" className="h-6 w-48 max-w-full" />}</SheetTitle>
          {data && (data.professional_title || data.current_company) && <p className="break-words text-sm text-muted-foreground">{data.professional_title}{corrected(data, "professional_title") && <> <Badge variant="accent">Corregido</Badge></>}{data.professional_title && data.current_company && " · "}{data.current_company}{corrected(data, "current_company") && <> <Badge variant="accent">Corregido</Badge></>}</p>}
          {data ? <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{data.kind === "manual" ? "Manual" : "Orgánico"}</Badge>{data.corrected_fields.length > 0 && <CorrectedBadge />}</div> : result === null && <Skeleton aria-hidden="true" className="h-6 w-20" />}
        </div>
      </div>
      <SheetDescription className="flex items-center gap-1.5 text-xs"><Clock3 aria-hidden="true" className="size-3.5 shrink-0" /><span>{data ? data.kind === "manual"
        ? <>Agregado por {data.created_by?.name ?? "Cuenta no disponible"} · <MovementDate value={data.created_at} /></>
        : <>Primera postulación · <MovementDate value={data.created_at} /></>
        : "Información privada de tu organización."}</span></SheetDescription>
      {data?.updated_by && data.updated_at && <p className="text-xs text-muted-foreground">Editado por {data.updated_by.name ?? "Cuenta no disponible"} · <MovementDate value={data.updated_at} /></p>}
      {data && !editing && <Button ref={editButtonRef} type="button" variant="outline" className="min-h-10 w-full" disabled={busy} onClick={() => setEditing(true)}><Pencil aria-hidden="true" data-icon="inline-start" />Editar datos</Button>}
    </SheetHeader>
    {editing && data ? <><Separator /><CandidateEditForm ref={formRef} candidate={data} onCancel={readView} onSaved={saved} onConflict={refreshConflict} /></> : <>
    {data ? <Tabs value={tab} onValueChange={value => setTab(String(value))} className="min-h-0 flex-1 gap-0">
      <div className="shrink-0 border-b px-6 pb-2">
        <TabsList variant="line" aria-label="Secciones de la ficha" className="max-w-full justify-start gap-4">
          <TabsTrigger value="summary">Resumen</TabsTrigger>
          <TabsTrigger value="processes">Procesos <Badge variant="secondary">{data.participations.length}</Badge></TabsTrigger>
          {/* The history endpoint is cursor-only: loaded entries are not a total. */}
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="summary" keepMounted className="min-h-0 overflow-y-auto overscroll-contain p-6">
        <div className="flex flex-col gap-6"><Contact detail={data} /><Separator /><Profile detail={data} /><Separator /><ActiveProcesses detail={data} onViewAll={() => setTab("processes")} /></div>
      </TabsContent>
      {/* Keep sessions mounted across tabs: selected files, action status and cursor pages survive navigation. */}
      <TabsContent value="processes" keepMounted className="min-h-0 overflow-y-auto overscroll-contain p-6">
        <Processes detail={data} busy={busy} onBusyChange={onBusyChange} onConfirmationChange={onConfirmationChange} onCvSaved={cvSaved} onCvConflict={refreshConflict} />
      </TabsContent>
      <TabsContent value="history" keepMounted className="min-h-0 overflow-y-auto overscroll-contain p-6">
        <ChangeHistory candidate={{ kind, id }} refreshKey={historyRefreshKey} />
      </TabsContent>
    </Tabs> : <div className="min-h-0 flex-1 overflow-y-auto border-t p-6" aria-busy={result === null}>
      {!result ? <DetailSkeleton /> : !result.ok ? <StateCard icon={Info} tone={result.reason === "not_found" ? "empty" : "error"}
        title={result.reason === "not_found" ? "Este candidato ya no está disponible" : "No pudimos cargar el detalle"}
        description={result.reason === "not_found" ? "El registro no está disponible en tu organización. Puedes cerrar la ficha y volver al listado." : result.reason === "unauthenticated" ? "Tu sesión expiró. Inicia sesión de nuevo para consultar la ficha." : "No se modificó ningún dato. Puedes volver a cargar la ficha."}
        {...(result.reason !== "not_found" ? { primaryAction: { label: "Reintentar", onClick: () => { setResult(null); setAttempt(value => value + 1); } } } : {})} />
        : null}
    </div>}
    <SheetFooter className="border-t"><p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />Solo visible para tu equipo de reclutamiento</p></SheetFooter>
    </>}
  </SheetContent>;
});
function corrected(detail: OrgCandidateDetail, field: CandidateEditField) {
  return detail.kind === "organic" && detail.corrected_fields.includes(field);
}
function CorrectedBadge() {
  return <Badge variant="accent"><Check aria-hidden="true" data-icon="inline-start" />Corregido</Badge>;
}
function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{children}</h3>;
}
const missing = <span className="text-muted-foreground">Sin dato</span>;
function FactRows({ rows }: { rows: { label: string; icon: typeof Mail; value: ReactNode; corrected?: boolean }[] }) {
  return <dl className="grid grid-cols-[44%_minmax(0,1fr)] items-start gap-x-2 gap-y-5">{rows.map(({ label, icon: Icon, value, corrected }) => <div key={label} className="contents">
    <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{label}</dt>
    <dd className="min-w-0 break-words text-sm">{corrected ? <div className="flex flex-wrap items-center gap-2">{value}<CorrectedBadge /></div> : value}</dd>
  </div>)}</dl>;
}
function Contact({ detail }: { detail: OrgCandidateDetail }) {
  const { contact } = detail;
  const phone = contact.phone?.replace(/^\+52(\d{2})(\d{4})(\d{4})$/, "+52 $1 $2 $3");
  const rows = [
    { field: "email" as const, icon: Mail, value: contact.email, href: `mailto:${contact.email}` },
    { field: "phone" as const, icon: Phone, value: phone, href: `tel:${contact.phone?.replace(/[^\d+]/g, "")}` },
  ];
  return <section aria-label="Contacto" className="flex flex-col gap-5"><SectionTitle>Contacto</SectionTitle><div className="flex flex-col gap-1.5">{rows.map(({ field, icon: Icon, value, href }) => <div key={field} className="flex min-h-10 items-center gap-2.5 text-sm">
    <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    {value ? <a className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 hover:underline" href={href}><span className="min-w-0 flex-1 break-words">{value}</span>{corrected(detail, field) && <CorrectedBadge />}<ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /></a> : missing}
  </div>)}</div></section>;
}
function Profile({ detail }: { detail: OrgCandidateDetail }) {
  const { profile } = detail;
  const catalog = useLanguageCatalog();
  const education = [profile.education.highest_completed && educationLabels[profile.education.highest_completed], profile.education.in_progress && `${educationLabels[profile.education.in_progress]} en curso`].filter(Boolean).join(" · ");
  const skills = detail.skills.filter(skill => normalizedProfileLabel(skill));
  const links: { field: "linkedin_url" | "portfolio_url"; label: string }[] = [{ field: "linkedin_url", label: "LinkedIn" }, { field: "portfolio_url", label: "Portafolio" }];
  return <section aria-label="Perfil profesional" className="flex flex-col gap-5"><SectionTitle>Perfil profesional</SectionTitle><FactRows rows={[
    { label: "Ubicación", icon: MapPin, corrected: corrected(detail, "location"), value: profile.location?.label ?? missing },
    { label: "Experiencia", icon: BriefcaseBusiness, corrected: corrected(detail, "years_of_experience"), value: profile.years_of_experience === null ? missing : plural(Number(profile.years_of_experience), "año", "años") },
    { label: "Seniority", icon: TrendingUp, corrected: corrected(detail, "seniority"), value: profile.seniority === null ? missing : SENIORITY_LABELS[profile.seniority] },
    { label: "Estudios", icon: GraduationCap, corrected: corrected(detail, "education"), value: education || missing },
    { label: "Idiomas", icon: Languages, corrected: corrected(detail, "languages"), value: profile.languages.length ? <div className="flex flex-wrap gap-2">{profile.languages.map(language => <Badge key={language.code} variant="outline">{catalog.data?.items.find(item => item.code === language.code)?.name ?? "Idioma no disponible"} {language.level === "native" ? "Nativo" : language.level}</Badge>)}</div> : missing },
    { label: "Enlaces", icon: Link, value: <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{links.filter(({ field }) => detail[field] && /^https?:\/\//i.test(detail[field]!)).map(({ field, label }) => <div key={field} className="flex flex-wrap items-center gap-1"><a className="inline-flex items-center gap-0.5 underline underline-offset-4" href={detail[field]!} target="_blank" rel="noopener noreferrer">{label}<ArrowUpRight aria-hidden="true" className="size-3" /></a>{corrected(detail, field) && <CorrectedBadge />}</div>)}{!links.some(({ field }) => detail[field] && /^https?:\/\//i.test(detail[field]!)) && missing}</div> },
  ]} />
    <div aria-label="Habilidades" className="flex flex-wrap items-center gap-2">{skills.length ? skills.map((skill, index) => <Badge key={index} variant="secondary">{skill}</Badge>) : missing}{corrected(detail, "skills") && <CorrectedBadge />}</div>
    {detail.corrected_fields.length > 0 && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />El perfil incluye correcciones internas de tu empresa.</p>}
  </section>;
}
function newestParticipations(detail: OrgCandidateDetail) {
  return [...detail.participations].sort((a, b) => Date.parse(b.applied_at) - Date.parse(a.applied_at));
}
function ActiveProcesses({ detail, onViewAll }: { detail: OrgCandidateDetail; onViewAll: () => void }) {
  const items = newestParticipations(detail).filter(item => item.state === "active" && item.vacancy.lifecycle.process === "active");
  return <section aria-label="Procesos activos" className="flex flex-col gap-5">
    <div className="flex items-center justify-between gap-3"><SectionTitle>Procesos activos</SectionTitle><Button type="button" variant="ghost" className="min-h-10" onClick={onViewAll}>Ver todos<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button></div>
    {items.length ? <ItemGroup>{items.map(item => <Item key={item.id} size="sm" role="listitem"><ItemContent className="min-w-0"><ItemTitle className="line-clamp-none break-words">{item.vacancy.title}</ItemTitle><ItemDescription className="text-xs">{item.source === "manual" ? "Ingreso manual" : "Postulación"} · <MovementDate value={item.applied_at} /></ItemDescription></ItemContent><Badge variant="info" dot>{item.stage.name}</Badge></Item>)}</ItemGroup> : <p className="text-sm text-muted-foreground">Sin procesos activos</p>}
  </section>;
}
type CvCallbacks = { busy: boolean; onBusyChange: (busy: boolean) => void; onConfirmationChange: (confirmation: CvConfirmation | null) => void; onCvSaved: (detail: OrgCandidateDetail) => void; onCvConflict: () => Promise<void> };
function Processes({ detail, ...cvCallbacks }: { detail: OrgCandidateDetail } & CvCallbacks) {
  const items = newestParticipations(detail);
  return <section aria-label="Procesos" className="flex flex-col gap-6"><SectionTitle>Todas sus oportunidades</SectionTitle>{items.length ? <div role="list" className="flex flex-col gap-6">{items.map((item, index) => <div key={item.id} className="contents">{index > 0 && <Separator />}<ParticipationItem item={item} candidate={detail} {...cvCallbacks} /></div>)}</div> : <p className="text-sm text-muted-foreground">Sin procesos</p>}</section>;
}
function ParticipationItem({ item, candidate, busy, onBusyChange, onCvSaved, onCvConflict, onConfirmationChange }: { item: OrgCandidateParticipation; candidate: OrgCandidateDetail } & CvCallbacks) {
  const publication = item.vacancy.lifecycle.publication;
  return <div role="listitem" className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 text-sm font-semibold"><a className="break-words underline-offset-4 hover:underline" href={`/empresa/vacantes/${encodeURIComponent(item.vacancy.id)}/pipeline`}>{item.vacancy.title}<ArrowUpRight aria-hidden="true" className="ml-1 inline size-3.5" /></a></h4>
        <div className="flex shrink-0 flex-col items-end gap-2"><Badge variant={publication === "published" ? "success" : publication === "paused" ? "review" : "neutral"} dot>{publication === "published" ? "Activa" : publication === "paused" ? "Pausada" : publication === "closed" ? "Cerrada" : "Borrador"}</Badge>{item.vacancy.lifecycle.process === "finished" && <Badge variant="neutral">Proceso finalizado</Badge>}</div>
      </div>
      <p className="text-sm">{item.stage.name}{item.substate ? ` · ${item.substate.name}` : ""}</p>
      <p className="text-xs text-muted-foreground">{item.source === "manual" ? "Ingreso manual" : "Postulación"} <MovementDate value={item.applied_at} />{item.added_by && <> · Agregado por {item.added_by.name}</>}</p>
    </div>
    <ParticipationCv item={item} candidate={candidate} busy={busy} onBusyChange={onBusyChange} onConfirmationChange={onConfirmationChange} onSaved={onCvSaved} onConflict={onCvConflict}>
      {item.discard && <><p className="text-sm font-medium">Descartado · {discardReasonLabel(item.discard.reason)}</p>{item.discard.comment && <p className="whitespace-pre-wrap break-words text-sm">{item.discard.comment}</p>}</>}
    </ParticipationCv>
  </div>;
}
function DetailSkeleton() {
  return <div data-org-detail-skeleton className="flex flex-col gap-6"><span role="status" className="sr-only">Cargando detalle</span>
    {[2, 6, 1].map((rows, section) => <div key={section} className="contents">{section > 0 && <Separator />}<section aria-hidden="true" className="flex flex-col gap-5"><Skeleton className="h-4 w-32" />{section === 2 ? <ItemGroup><Item size="sm"><ItemContent><ItemTitle><Skeleton className="h-5 w-40" /></ItemTitle><Skeleton className="h-4 w-32"><ItemDescription className="invisible">&nbsp;</ItemDescription></Skeleton></ItemContent><Skeleton className="h-5 w-20" /></Item></ItemGroup> : section === 0 ? Array.from({ length: rows }, (_, index) => <div key={index} className="flex min-h-10 items-center gap-2.5"><Skeleton className="size-4" /><Skeleton className="h-5 w-48 max-w-full" /></div>) : <><dl className="grid grid-cols-[44%_minmax(0,1fr)] gap-x-2 gap-y-5">{Array.from({ length: rows }, (_, index) => <div key={index} className="contents"><dt className="flex items-center gap-2"><Skeleton className="size-4 shrink-0" /><Skeleton className="h-4 w-24 max-w-full" /></dt><dd><Skeleton className="h-5 w-28 max-w-full" /></dd></div>)}</dl><Skeleton className="h-6 w-40" /></>}</section></div>)}
  </div>;
}
