"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, BriefcaseBusiness, CalendarDays, FileText, GraduationCap, Info, Languages, Mail, MapPin, Phone, Sparkles, TrendingUp, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
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
import { loadOrgCandidateDetailAction } from "./detail-actions";
import { candidateCvHref, type DetailResult, type OrgCandidateDetail, type OrgCandidateIdentity, type OrgCandidateParticipation } from "./detail-model";

type Props = { candidate: { kind: "manual" | "organic"; id: string } | null; onOpenChange: (open: boolean) => void };
/** sheet-demo composition, controlled without Trigger because either list view opens the same sheet.
 * Like the board: one Spanish close, title focus, fixed identity, one scrolling body.
 */
export function OrgCandidateDetailSheet({ candidate, onOpenChange }: Props) {
  return <Sheet open={candidate !== null} onOpenChange={open => onOpenChange(open)}>
    {candidate && <DetailSession key={`${candidate.kind}:${candidate.id}`} candidate={candidate} />}
  </Sheet>;
}
function DetailSession({ candidate: { kind, id } }: { candidate: OrgCandidateIdentity }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [result, setResult] = useState<DetailResult | null>(null);
  const [attempt, setAttempt] = useState(0);
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
    className="gap-0 bg-card data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-6 py-3">
      <span className="text-xs text-muted-foreground">Ficha del candidato</span>
      <SheetClose render={<Button type="button" variant="ghost" size="icon" aria-label="Cerrar ficha" />}><X aria-hidden="true" /></SheetClose>
    </div>
    <SheetHeader className="gap-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-12 shrink-0"><AvatarFallback>{data ? initials(data.full_name) : <Skeleton aria-hidden="true" className="size-12 rounded-full" />}</AvatarFallback></Avatar>
        <div className="flex min-w-0 flex-col gap-1.5">
          <SheetTitle ref={titleRef} tabIndex={-1} className="break-words text-lg font-semibold outline-none">{data?.full_name ?? <span className={result === null ? "sr-only" : undefined}>Detalle del candidato</span>}{result === null && <Skeleton aria-hidden="true" className="h-6 w-48 max-w-full" />}</SheetTitle>
          {data && (data.professional_title || data.current_company) && <p className="break-words text-sm text-muted-foreground">{[data.professional_title, data.current_company].filter(Boolean).join(" · ")}</p>}
          {data ? <div><Badge variant="accent">{data.kind === "manual" ? "Manual" : "Orgánico"}</Badge></div> : result === null && <Skeleton aria-hidden="true" className="h-6 w-20" />}
        </div>
      </div>
      <SheetDescription className="text-xs">{data ? data.kind === "manual"
        ? <>Agregado por {data.created_by?.name ?? "Cuenta no disponible"} el <MovementDate value={data.created_at} /></>
        : <>Primera postulación el <MovementDate value={data.created_at} /></>
        : "Información privada de tu organización."}</SheetDescription>
    </SheetHeader>
    <Separator />
    <div className="min-h-0 flex-1 overflow-y-auto p-6" aria-busy={result === null}>
      {!result ? <DetailSkeleton /> : !result.ok ? <StateCard icon={Info} tone={result.reason === "not_found" ? "empty" : "error"}
        title={result.reason === "not_found" ? "Este candidato ya no está disponible" : "No pudimos cargar el detalle"}
        description={result.reason === "not_found" ? "El registro no está disponible en tu organización. Puedes cerrar la ficha y volver al listado." : result.reason === "unauthenticated" ? "Tu sesión expiró. Inicia sesión de nuevo para consultar la ficha." : "No se modificó ningún dato. Puedes volver a cargar la ficha."}
        {...(result.reason !== "not_found" ? { primaryAction: { label: "Reintentar", onClick: () => { setResult(null); setAttempt(value => value + 1); } } } : {})} />
        : <div className="flex flex-col gap-7"><Contact contact={result.data.contact} /><Separator /><Profile profile={result.data.profile} manual={result.data.kind === "manual"} /><Separator /><Processes detail={result.data} /></div>}
    </div>
    <SheetFooter className="border-t"><p className="text-xs text-muted-foreground">Solo visible para tu equipo de reclutamiento.</p></SheetFooter>
  </SheetContent>;
}
function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{children}</h3>;
}
const missing = <span className="text-muted-foreground">Sin dato</span>;
function FactRows({ rows }: { rows: { label: string; icon: typeof Mail; value: ReactNode }[] }) {
  return <dl className="grid grid-cols-2 items-center gap-x-4 gap-y-5">{rows.map(({ label, icon: Icon, value }) => <div key={label} className="contents">
    <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{label}</dt>
    <dd className="min-w-0 break-words text-sm font-medium">{value}</dd>
  </div>)}</dl>;
}
function Contact({ contact }: { contact: OrgCandidateDetail["contact"] }) {
  const phone = contact.phone?.replace(/^\+52(\d{2})(\d{4})(\d{4})$/, "+52 $1 $2 $3");
  const email = contact.email;
  const at = email?.lastIndexOf("@") ?? -1;
  return <section aria-label="Contacto" className="flex flex-col gap-5"><SectionTitle>Contacto</SectionTitle><FactRows rows={[
    { label: "Correo", icon: Mail, value: email ? <a className="underline underline-offset-4" href={`mailto:${email}`} aria-label={email}>{at < 0 ? email : <>{email.slice(0, at + 1)}<wbr />{email.slice(at + 1)}</>}</a> : missing },
    { label: "Teléfono", icon: Phone, value: contact.phone ? <a className="tabular-nums underline underline-offset-4" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{phone}</a> : missing },
  ]} /></section>;
}
function Profile({ profile, manual }: { profile: OrgCandidateDetail["profile"]; manual: boolean }) {
  const catalog = useLanguageCatalog();
  const education = [profile.education.highest_completed && educationLabels[profile.education.highest_completed], profile.education.in_progress && `${educationLabels[profile.education.in_progress]} en curso`].filter(Boolean).join(" · ");
  const skills = profile.skills.filter(skill => normalizedProfileLabel(skill));
  return <section aria-label="Perfil" className="flex flex-col gap-5"><SectionTitle>Perfil</SectionTitle><FactRows rows={[
    { label: "Ubicación", icon: MapPin, value: profile.location?.label ?? missing },
    { label: "Habilidades", icon: Sparkles, value: skills.length ? <div className="flex flex-wrap gap-2">{skills.map((skill, index) => <Badge key={index} variant="outline">{skill}</Badge>)}</div> : missing },
    { label: "Años de experiencia", icon: BriefcaseBusiness, value: profile.years_of_experience === null ? missing : plural(Number(profile.years_of_experience), "año", "años") },
    { label: "Seniority", icon: TrendingUp, value: profile.seniority === null ? missing : SENIORITY_LABELS[profile.seniority] },
    { label: "Nivel de estudios", icon: GraduationCap, value: education || missing },
    { label: "Idiomas", icon: Languages, value: profile.languages.length ? <div className="flex flex-wrap gap-2">{profile.languages.map(language => <Badge key={language.code} variant="outline">{catalog.data?.items.find(item => item.code === language.code)?.name ?? "Idioma no disponible"} {language.level === "native" ? "Nativo" : language.level}</Badge>)}</div> : missing },
  ]} /><p className="text-xs text-muted-foreground">{manual ? "Registrado al agregar al candidato." : "Copiado del perfil de su participación más reciente en tu organización."}</p></section>;
}
function Processes({ detail }: { detail: OrgCandidateDetail }) {
  const items = [...detail.participations].sort((a, b) => Date.parse(b.applied_at) - Date.parse(a.applied_at));
  return <section aria-label="Procesos" className="flex flex-col gap-5"><SectionTitle>Procesos</SectionTitle>{items.length ? <ItemGroup>{items.map(item => <ParticipationItem key={item.id} item={item} candidate={detail} />)}</ItemGroup> : <p className="text-sm text-muted-foreground">Sin procesos</p>}</section>;
}
function ParticipationItem({ item, candidate }: { item: OrgCandidateParticipation; candidate: OrgCandidateIdentity }) {
  const publication = item.vacancy.lifecycle.publication;
  return <Item variant="outline"><ItemContent className="min-w-0 gap-3">
    <ItemTitle><a className="break-words underline underline-offset-4" href={`/empresa/vacantes/${encodeURIComponent(item.vacancy.id)}/pipeline`}>{item.vacancy.title}</a></ItemTitle>
    <ItemDescription>{item.stage.name}{item.substate ? ` · ${item.substate.name}` : ""}</ItemDescription>
    <div className="flex flex-wrap gap-2"><Badge variant={publication === "published" ? "success" : publication === "paused" ? "review" : "neutral"} dot>{publication === "published" ? "Publicada" : publication === "paused" ? "Pausada" : publication === "closed" ? "Cerrada" : "Borrador"}</Badge>{item.vacancy.lifecycle.process === "finished" && <Badge variant="neutral">Proceso finalizado</Badge>}</div>
    {item.discard && <><p className="text-sm font-medium">Descartado · {discardReasonLabel(item.discard.reason)}</p>{item.discard.comment && <p className="whitespace-pre-wrap break-words text-sm">{item.discard.comment}</p>}</>}
    <div className="flex flex-col gap-1 text-xs text-muted-foreground"><p>{item.source === "manual" ? "Ingreso manual" : "Postulación"}</p>{item.added_by && <p>Agregado por {item.added_by.name}</p>}<p className="flex items-center gap-2"><CalendarDays aria-hidden="true" className="size-4 shrink-0" /><MovementDate value={item.applied_at} /></p></div>
    {item.cv ? <div className="flex flex-col gap-3"><p className="flex min-w-0 items-center gap-2 text-sm"><FileText aria-hidden="true" className="size-4 shrink-0" /><span className="break-all">{item.cv.file_name}</span></p><a className={buttonVariants({ variant: "outline" })} href={candidateCvHref(candidate, item.id)} download aria-label={`Descargar CV de ${item.vacancy.title}`}><ArrowDownToLine aria-hidden="true" data-icon="inline-start" />Descargar CV</a></div> : <p className="text-sm text-muted-foreground">Sin CV</p>}
  </ItemContent></Item>;
}
function DetailSkeleton() {
  return <div data-org-detail-skeleton className="flex flex-col gap-7"><span role="status" className="sr-only">Cargando detalle</span>
    {[2, 6, 1].map((rows, section) => <div key={section} className="contents">{section > 0 && <Separator />}<section aria-hidden="true" className="flex flex-col gap-5"><Skeleton className="h-4 w-24" />{section === 2 ? <ItemGroup><Item variant="outline"><ItemContent className="gap-3"><ItemTitle><Skeleton className="h-5 w-40" /></ItemTitle><Skeleton className="h-4 w-32"><ItemDescription className="invisible">&nbsp;</ItemDescription></Skeleton><Skeleton className="h-6 w-24" /><Skeleton className="h-10 w-full" /></ItemContent></Item></ItemGroup> : <dl className="grid grid-cols-2 items-center gap-x-4 gap-y-5">{Array.from({ length: rows }, (_, index) => <div key={index} className="contents"><dt className="flex items-center gap-2"><Skeleton className="size-4 shrink-0" /><Skeleton className="h-4 w-24 max-w-full" /></dt><dd><Skeleton className="h-5 w-28 max-w-full" /></dd></div>)}</dl>}</section></div>)}
  </div>;
}
