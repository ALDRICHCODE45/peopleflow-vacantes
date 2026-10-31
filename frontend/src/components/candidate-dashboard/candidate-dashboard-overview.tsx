"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, ClipboardList, Files, UserRound, type LucideIcon } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { ApplicationMessage } from "@/features/candidate/application-message";
import { profileFromWire } from "@/features/candidate/profile-adapter";
import { missingProfileText, profileCompleteness } from "@/features/candidate/profile-completeness";
import type { ProfileLanguages, ProfileRead } from "@/features/candidate/profile-api";
import type { ApplicationsPage } from "@/features/candidate-applications/model";
import type { CvLibrary } from "@/features/candidate-cvs/model";
import type { AccountAssessments } from "@/features/psychometrics/model";
import { isWrongRole, SourceError, SourceErrorCard, SourceLoading, useSource, type Source } from "@/features/candidate/dashboard/source";
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { loadProfileAction } from "@/features/candidate/profile-actions";
const loadApplications = () => loadApplicationsAction({ limit: 50 });

export type CandidateDashboardOverviewProps = {
  assessments: Source<AccountAssessments>;
  onFirstVisit: (first: boolean) => void;
  firstName?: string;
};
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const quietLink = buttonVariants({ variant: "ghost", size: "sm", className: "min-h-10" });
const date = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const labels = { submitted: "Enviada", in_process: "En proceso", closed: "Cerrada" } as const;
const variants = { submitted: "info", in_process: "accent", closed: "neutral" } as const;

function Metric<T>({ label, icon: Icon, description, source, loadingLabel, errorLabel, value, children, href, action, hideAction = false }: {
  label: string; icon: LucideIcon; description: string; source: Source<T>; loadingLabel: string; errorLabel: string;
  value?: ReactNode; children?: ReactNode; href: string; action: string; hideAction?: boolean;
}) {
  if (source.result && !source.result.ok && isWrongRole(source.result)) return <section role="region" aria-label={label}><SourceError failure={source.result} retry={source.retry} label={errorLabel} /></section>;
  return <Card size="sm" role="region" aria-label={label} aria-busy={!source.result}>
    <CardHeader>
      <CardTitle><h2 className="flex items-center gap-3 text-sm font-medium"><span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-foreground"><Icon className="size-5" /></span>{label}</h2></CardTitle>
      <CardDescription>{description}</CardDescription>
      {(!source.result || source.result.ok) && <CardAction>{!source.result ? <Skeleton aria-hidden="true" className="h-9 w-16" /> : <strong className="text-3xl font-semibold tracking-tight tabular-nums">{value}</strong>}</CardAction>}
    </CardHeader>
    <CardContent>
      {!source.result ? <SourceLoading label={loadingLabel} compact /> : !source.result.ok ? <SourceError failure={source.result} retry={source.retry} label={errorLabel} /> : children}
    </CardContent>
    {!source.result ? <CardFooter><Skeleton aria-hidden="true" className="h-10 w-36" /></CardFooter> : source.result.ok && !hideAction && <CardFooter><Link className={quietLink} href={href}>{action}<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link></CardFooter>}
  </Card>;
}
/** Profile/CV/application read island. Each action has its own lifetime and feedback;
 * the parent grid places the independent assessment-hook rail beside this log. */
export function CandidateDashboardOverview({ assessments, onFirstVisit, firstName }: CandidateDashboardOverviewProps) {
  const applications = useSource<ApplicationsPage>(loadApplications);
  const cvs = useSource<CvLibrary>(loadCvsAction);
  const profile = useSource<{ profile: ProfileRead | null; languages: ProfileLanguages }>(loadProfileAction);
  const appData = applications.result?.ok ? applications.result.data : undefined;
  const cvData = cvs.result?.ok ? cvs.result.data : undefined;
  const profileData = profile.result?.ok ? profile.result.data : undefined;
  const completeness = profileData ? profileCompleteness(profileData.profile ? profileFromWire(profileData.profile, profileData.languages) : null) : undefined;
  const firstVisit = !!(appData && appData.items.length === 0 && cvData && cvData.items.length === 0 && completeness && completeness.percentage < 100);
  useEffect(() => { onFirstVisit(firstVisit); }, [firstVisit, onFirstVisit]);
  const sent = appData?.items.filter(item => item.status === "submitted").length ?? 0;
  const process = appData?.items.filter(item => item.status === "in_process").length ?? 0;
  const pending = assessments.result?.ok ? assessments.result.data.items.length : undefined;
  const recent = appData ? [...appData.items].sort((a, b) => Date.parse(b.updated_at ?? b.applied_at) - Date.parse(a.updated_at ?? a.applied_at)) : [];
  return <>
    <header className="order-1 flex flex-col gap-1 lg:order-none lg:col-span-2">
      <h2 className="text-2xl font-semibold tracking-tight">{firstName ? `Hola, ${firstName}` : "Tu búsqueda de empleo"}</h2>
      <p className="text-sm text-muted-foreground">{firstVisit ? "Empieza tu búsqueda: completa tu perfil, sube tu CV y explora vacantes." : pending === 0 ? "Estás al día. Puedes seguir tus postulaciones o explorar nuevas vacantes." : pending !== undefined ? `Tienes ${count(pending, "evaluación pendiente", "evaluaciones pendientes")}.` : "Sigue tus postulaciones y encuentra tu próximo paso."}</p>
    </header>
    <section aria-label="Resumen de tu búsqueda" className="order-2 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:order-none lg:col-span-2">
      <Metric label="Por atender" icon={ClipboardList} description="Evaluaciones pendientes" source={assessments} loadingLabel="Cargando evaluaciones" errorLabel="las evaluaciones" value={pending} href={firstVisit ? "/vacantes" : "#dashboard-attention"} action={firstVisit ? "Explorar vacantes" : "Ver pendientes"}>
        <p className="text-xs text-muted-foreground">{firstVisit ? "Aquí verás tus próximos pendientes." : pending === 0 ? "Estás al día. No tienes pendientes." : count(pending ?? 0, "evaluación pendiente", "evaluaciones pendientes")}</p>
      </Metric>
      <Metric label="Postulaciones activas" icon={BriefcaseBusiness} description="Enviadas y en proceso" source={applications} loadingLabel="Cargando postulaciones" errorLabel="las postulaciones" value={sent + process} href={firstVisit ? "/vacantes" : "/candidato/postulaciones"} action={firstVisit ? "Explorar vacantes" : "Ver postulaciones"}>
        <p className="text-xs text-muted-foreground">{appData?.items.length === 0 ? "Aún no has enviado postulaciones." : `${count(sent, "enviada", "enviadas")} · ${count(process, "en proceso", "en proceso")}`}</p>
        {appData?.next_cursor && <p className="mt-2 text-xs text-muted-foreground">Resumen de las últimas {appData.items.length} postulaciones. Consulta todas en Postulaciones.</p>}
      </Metric>
      <Metric hideAction={firstVisit} label="Perfil" icon={UserRound} description="Datos de tu perfil" source={profile} loadingLabel="Cargando perfil" errorLabel="tu perfil" value={`${completeness?.percentage}%`} href="/candidato/perfil" action={completeness?.percentage === 100 ? "Ver perfil" : firstVisit ? "Revisar perfil" : "Completar perfil"}>
        {firstVisit ? <SectionEmpty icon={UserRound} tone="info" title="Prepara tu perfil" description={`Completa tus datos para presentarte a las empresas. Te falta: ${missingProfileText(completeness?.missing ?? [])}.`} primaryAction={{ href: "/candidato/perfil", label: "Completar perfil" }} /> : <p className="text-xs text-muted-foreground">{completeness?.missing.length ? `Te falta: ${missingProfileText(completeness.missing)}` : "Tu perfil está completo."}</p>}
        <Progress aria-label="Completitud del perfil" value={completeness?.percentage ?? 0} />
      </Metric>
      <Metric hideAction={cvData?.items.length === 0} label="CVs" icon={Files} description="Versiones en tu biblioteca" source={cvs} loadingLabel="Cargando CVs" errorLabel="tus CVs" value={`${cvData?.items.length} de ${cvData?.limits.max_cvs}`} href="/candidato/cvs" action="Ir a mis CVs">
        {cvData?.items.length === 0 ? <SectionEmpty icon={Files} tone="empty" title="Todavía no tienes CVs" description="Sube un CV para elegirlo al postularte." primaryAction={{ href: "/candidato/cvs", label: "Subir CV" }} /> : <p className="text-xs text-muted-foreground">{count(cvData?.items.filter(cv => cv.in_use).length ?? 0, "enviado en postulaciones", "enviados en postulaciones")}</p>}
      </Metric>
    </section>
    <section aria-labelledby="dashboard-recent" className="order-4 min-w-0 lg:order-none lg:col-start-1 lg:row-start-3">
      <header className="mb-3 flex min-h-10 items-center justify-between gap-3"><div><h2 id="dashboard-recent" className="text-base font-semibold">Postulaciones recientes</h2><p className="text-xs text-muted-foreground">Última actualización de cada proceso</p></div><Link className={quietLink} href="/candidato/postulaciones">Ver todas<ArrowRight aria-hidden="true" /></Link></header>
      {!applications.result ? <Card size="sm"><CardHeader><CardTitle className="sr-only">Postulaciones</CardTitle></CardHeader><CardContent><SourceLoading label="Cargando postulaciones" /></CardContent></Card> : !applications.result.ok ? <SourceErrorCard failure={applications.result} retry={applications.retry} label="las postulaciones" /> : recent.length === 0 ? <StateCard icon={BriefcaseBusiness} tone="empty" title="Aún no tienes postulaciones" description="Aquí podrás seguir tus procesos después de enviar tu primera postulación. Encuentra una vacante que te interese." primaryAction={{ href: "/vacantes", label: "Explorar vacantes" }} /> : <ol aria-label="Bitácora de postulaciones" className="pl-2 sm:pl-5">{recent.map(item => <li key={item.id} className="relative border-l border-border pb-3 pl-5 last:border-transparent before:absolute before:top-5 before:-left-1 before:size-2 before:rounded-full before:bg-primary">
        <Card size="sm">
          <CardHeader><CardTitle><h3 className="break-words text-sm font-medium"><Link className="inline-flex min-h-10 items-center hover:underline" href="/candidato/postulaciones">{item.vacancy.title}</Link></h3></CardTitle><CardDescription className="break-words text-xs">{item.company.name}</CardDescription><CardAction><Badge variant={variants[item.status]} dot>{labels[item.status]}</Badge></CardAction></CardHeader>
          <CardFooter className="flex-wrap gap-2 text-xs text-muted-foreground"><p>{item.updated_at ? "Actualizada el " : "Postulaste el "}<time dateTime={item.updated_at ?? item.applied_at}>{date.format(new Date(item.updated_at ?? item.applied_at))}</time></p>
            {item.status === "closed" && item.message !== null && <ApplicationMessage showUnread={false} triggerLabel="Leer mensaje" message={{ applicationId: item.id, sender: item.company.name, subject: "Mensaje de la empresa", body: item.message.split(/\r?\n/u) }} />}
          </CardFooter>
        </Card>
      </li>)}</ol>}
    </section>
  </>;
}
