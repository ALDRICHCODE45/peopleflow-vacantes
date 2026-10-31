"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, ClipboardList, Files, UserRound, type LucideIcon } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionEmpty } from "@/components/feedback/state-card";
import { ApplicationMessage } from "@/features/candidate/application-message";
import { profileFromWire } from "@/features/candidate/profile-adapter";
import { missingProfileText, profileCompleteness } from "@/features/candidate/profile-completeness";
import type { ProfileLanguages, ProfileRead } from "@/features/candidate/profile-api";
import type { ApplicationsPage } from "@/features/candidate-applications/model";
import type { CvLibrary } from "@/features/candidate-cvs/model";
import type { AccountAssessments } from "@/features/psychometrics/model";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { SourceError, SourceLoading, useSource, type Source } from "@/features/candidate/dashboard/source";
import { isUnread, type Application } from "@/features/candidate/dashboard/insights";
import { DashboardCharts, ApplicationStatus } from "@/features/candidate/dashboard/charts";
import { loadApplicationsAction, markMessageReadAction } from "@/features/candidate-applications/actions";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { loadProfileAction } from "@/features/candidate/profile-actions";
const loadApplications = () => loadApplicationsAction({ limit: 50 });
export type CandidateDashboardOverviewProps = { assessments: Source<AccountAssessments>; onFirstVisit: (first: boolean) => void; fullName?: string };
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const quietLink = buttonVariants({ variant: "ghost", size: "sm", className: "min-h-10" });
const date = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const labels = { submitted: "Enviada", in_process: "En proceso", closed: "Cerrada" } as const;
const variants = { submitted: "info", in_process: "accent", closed: "neutral" } as const;

function Metric<T>({ label, icon: Icon, source, loadingLabel, errorLabel, value, children, href, action }: {
  label: string; icon: LucideIcon; source: Source<T>; loadingLabel: string; errorLabel: string; value?: ReactNode; children?: ReactNode; href: string; action: string;
}) {
  return <Card size="sm" role="region" aria-label={label} aria-busy={!source.result} className="min-w-0">
    <CardHeader className="h-24 sm:h-16"><CardTitle><h2 className="flex flex-col gap-2 text-sm font-medium sm:flex-row sm:items-center"><span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-foreground"><Icon className="size-5" /></span>{label}</h2></CardTitle></CardHeader>
    <CardContent className="flex flex-1 flex-col gap-2">
      {!source.result ? <><Skeleton aria-hidden="true" className="h-9 w-16" /><SourceLoading label={loadingLabel} compact /></> : !source.result.ok ? <SourceError failure={source.result} retry={source.retry} label={errorLabel} /> : <><Link href={href} aria-label={action} className="inline-flex min-h-10 items-baseline gap-1 self-start rounded-sm text-3xl font-semibold tracking-tight tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-ring">{value}</Link><div className="min-h-9 text-xs text-muted-foreground">{children}</div></>}
    </CardContent>
  </Card>;
}
export function CandidateDashboardOverview({ assessments, onFirstVisit, fullName }: CandidateDashboardOverviewProps) {
  const applications = useSource<ApplicationsPage>(loadApplications);
  const cvs = useSource<CvLibrary>(loadCvsAction);
  const profile = useSource<{ profile: ProfileRead | null; languages: ProfileLanguages }>(loadProfileAction);
  // Confirmed reads are scoped to the exact visible revision, never a replacement message.
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const attempted = useRef(new Set<string>());
  const original = applications.result?.ok ? applications.result.data : undefined;
  const revision = (item: Application) => `${item.id}:${item.updated_at}`;
  const appData = original ? { ...original, items: original.items.map(item => read.has(revision(item)) ? { ...item, message_read_at: item.updated_at } : item) } : undefined;
  const cvData = cvs.result?.ok ? cvs.result.data : undefined;
  const profileData = profile.result?.ok ? profile.result.data : undefined;
  const completeness = profileData ? profileCompleteness(profileData.profile ? profileFromWire(profileData.profile, profileData.languages) : null) : undefined;
  const firstVisit = !!(appData && appData.items.length === 0 && cvData && cvData.items.length === 0);
  useEffect(() => { onFirstVisit(firstVisit); }, [firstVisit, onFirstVisit]);
  const sent = appData?.items.filter(item => item.status === "submitted").length ?? 0;
  const process = appData?.items.filter(item => item.status === "in_process").length ?? 0;
  const pending = assessments.result?.ok ? assessments.result.data.items.length : undefined;
  const unread = appData?.items.filter(isUnread) ?? [];
  const total = pending !== undefined && appData ? pending + unread.length : undefined;
  const next = assessments.result?.ok ? [...assessments.result.data.items].sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at))[0] : undefined;
  const recent = appData ? [...appData.items].sort((a, b) => Date.parse(b.updated_at ?? b.applied_at) - Date.parse(a.updated_at ?? a.applied_at)) : [];
  async function opened(item: Application) {
    const token = revision(item);
    if (!isUnread(item) || !item.updated_at || attempted.current.has(token)) return;
    attempted.current.add(token);
    try {
      const result = await markMessageReadAction(item.id, { updated_at: item.updated_at });
      if (result.ok) setRead(previous => new Set(previous).add(token));
      else if (result.reference.status === 409 && result.reference.code === "message_changed") applications.retry();
    } catch { /* A read acknowledgment must never interrupt reading or retry itself. */ }
  }
  const message = (item: Application) => <ApplicationMessage key={revision(item)} showUnread={isUnread(item)} onOpen={() => { void opened(item); }} triggerLabel="Leer mensaje" message={{ applicationId: item.id, sender: item.company.name, subject: "Mensaje de la empresa", body: item.message!.split(/\r?\n/u) }} />;
  return <>
    {assessments.result?.ok && <Card size="sm" role="region" aria-label="Pendientes" id="dashboard-attention" className="border-l-3 border-l-primary">
      <CardHeader><CardTitle><h2>Pendientes</h2></CardTitle><CardDescription>El siguiente paso de tu búsqueda.</CardDescription><CardAction>{total !== undefined && <Badge variant="accent">{total ? `${total} por responder` : "Todo al día"}</Badge>}</CardAction></CardHeader>
      <CardContent className="grid gap-3">
        {!assessments.result ? <SourceLoading label="Cargando evaluaciones" /> : !assessments.result.ok ? <SourceError failure={assessments.result} retry={assessments.retry} label="las evaluaciones" /> : next ? <Item><ItemMedia variant="icon"><ClipboardList aria-hidden="true" /></ItemMedia><ItemContent><ItemTitle className="line-clamp-none break-words">Evaluación · {next.vacancy.title}</ItemTitle><ItemDescription className="line-clamp-none break-words">{next.company.name} · Disponible hasta el {new Date(next.expires_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</ItemDescription></ItemContent><ItemActions><Link className={buttonVariants()} href={`/candidato/evaluaciones/${next.id}`}>Revisar pendiente<ArrowRight aria-hidden="true" /></Link></ItemActions></Item> : total === 0 ? <div><h3 className="font-medium">{firstVisit ? "Aquí aparecerán tus pendientes" : "Todo al día"}</h3><p className="text-xs text-muted-foreground">{firstVisit ? "Cuando una empresa te invite, encontrarás aquí tu siguiente paso." : "No tienes evaluaciones ni mensajes por responder. Tu búsqueda sigue avanzando."}</p></div> : null}
        {unread[0] && <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-medium">Mensaje · {unread[0].vacancy.title}</h3><p className="text-xs text-muted-foreground">{unread[0].company.name}</p></div><Link className={quietLink} href={`#application-${unread[0].id}`}>Revisar mensaje<ArrowRight aria-hidden="true" /></Link></div>}
      </CardContent>
    </Card>}
    <header className="flex flex-col gap-1"><h2 className="text-2xl font-semibold tracking-tight">{fullName ? `Hola, ${fullName}` : "Tu búsqueda de empleo"}</h2><p className="text-sm text-muted-foreground">{firstVisit ? "Prepara tu perfil y tu primer CV para empezar tu búsqueda." : total === 0 ? "Estás al día. Puedes seguir tus postulaciones o explorar nuevas vacantes." : appData ? `${count(sent + process, "postulación activa", "postulaciones activas")} y tres formas de entender cómo va tu búsqueda.` : "Sigue tus postulaciones y encuentra tu próximo paso."}</p></header>
    <section aria-label="Resumen de tu búsqueda" className="grid min-w-0 grid-cols-2 gap-4 min-[850px]:grid-cols-4">
      <Metric label="Por atender" icon={ClipboardList} source={assessments} loadingLabel="Cargando evaluaciones" errorLabel="las evaluaciones" value={total === undefined ? "—" : total} href="#dashboard-attention" action="Ver pendientes"><p>{pending !== undefined && count(pending, "evaluación por responder", "evaluaciones por responder")} · {appData ? count(unread.length, "mensaje sin leer", "mensajes sin leer") : "Mensajes por consultar"}</p></Metric>
      <Metric label="Postulaciones activas" icon={BriefcaseBusiness} source={applications} loadingLabel="Cargando postulaciones" errorLabel="las postulaciones" value={sent + process} href={firstVisit ? "/vacantes" : "/candidato/postulaciones"} action={firstVisit ? "Explorar vacantes" : "Ver postulaciones"}><p>{appData?.items.length === 0 ? "Aún no has enviado postulaciones." : `${count(sent, "enviada", "enviadas")} · ${count(process, "en proceso", "en proceso")}`}</p></Metric>
      <Metric label="Perfil" icon={UserRound} source={profile} loadingLabel="Cargando perfil" errorLabel="tu perfil" value={`${completeness?.percentage}%`} href="/candidato/perfil" action={completeness?.percentage === 100 ? "Ver perfil" : "Completar perfil"}><p>{completeness?.missing.length ? `Te falta: ${missingProfileText(completeness.missing)}` : "Tu perfil está completo."}</p></Metric>
      <Metric label="CVs" icon={Files} source={cvs} loadingLabel="Cargando CVs" errorLabel="tus CVs" value={<>{cvData?.items.length} <small className="text-base font-normal text-muted-foreground">de {cvData?.limits.max_cvs}</small></>} href="/candidato/cvs" action={cvData?.items.length === 0 ? "Subir CV" : "Ir a mis CVs"}><p>{count(cvData?.items.filter(cv => cv.in_use).length ?? 0, "enviado en postulaciones", "enviados en postulaciones")}</p></Metric>
    </section>
    {appData?.next_cursor && <p role="note" className="text-xs text-muted-foreground">Resumen de las últimas {appData.items.length} postulaciones. Consulta todas en Postulaciones.</p>}
    <DashboardCharts source={applications} />
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <Card size="sm" role="region" aria-label="Postulaciones recientes">
        <CardHeader className="border-b"><CardTitle><h2>Postulaciones recientes</h2></CardTitle><CardDescription>Ordenadas por su último cambio de estado.</CardDescription><CardAction><Link className={quietLink} href="/candidato/postulaciones">Ver todas<ArrowRight aria-hidden="true" /></Link></CardAction></CardHeader>
        <CardContent>
          {!applications.result ? <SourceLoading label="Cargando postulaciones" /> : !applications.result.ok ? <SourceError failure={applications.result} retry={applications.retry} label="las postulaciones" /> : recent.length === 0 ? <SectionEmpty tone="empty" icon={BriefcaseBusiness} title="Tu primera postulación va aquí" description="Explora vacantes y envía tu CV. Aquí verás cambios de estado y mensajes de las empresas." primaryAction={{ href: "/vacantes", label: "Explorar vacantes" }} /> : <ol aria-label="Bitácora de postulaciones" className="divide-y">{recent.map(item => <li key={item.id} id={`application-${item.id}`} className="flex flex-wrap items-center gap-3 py-4">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-foreground"><BriefcaseBusiness className="size-5" /></span>
            <div className="min-w-0 basis-44 flex-1"><h3 className="break-words text-sm font-medium"><Link className="hover:underline" href="/candidato/postulaciones">{item.vacancy.title}</Link></h3><p className="break-words text-xs text-muted-foreground">{item.company.name}</p><div className="mt-1 flex flex-wrap items-center gap-2"><Badge variant={variants[item.status]} dot>{labels[item.status]}</Badge><p className="text-xs text-muted-foreground">{item.updated_at ? "Actualizada el " : "Postulaste el "}<time dateTime={item.updated_at ?? item.applied_at}>{date.format(new Date(item.updated_at ?? item.applied_at))}</time></p></div></div>
            {item.status === "closed" && item.message !== null ? message(item) : <Link className={quietLink} href="/candidato/postulaciones">Ver postulación<ArrowRight aria-hidden="true" /></Link>}
          </li>)}</ol>}
        </CardContent>
      </Card>
      <ApplicationStatus source={applications} />
    </div>
  </>;
}
