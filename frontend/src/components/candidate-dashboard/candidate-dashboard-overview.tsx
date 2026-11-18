"use client";
import { memo, useCallback, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Check, Files, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SectionEmpty } from "@/components/feedback/state-card";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import { profileFromWire } from "@/features/candidate/profile-adapter";
import { profileCompleteness, type Completeness } from "@/features/candidate/profile-completeness";
import type { CandidateProfile } from "@/features/candidate/model";
import type { ProfileLanguages, ProfileRead } from "@/features/candidate/profile-api";
import type { ApplicationsPage } from "@/features/candidate-applications/model";
import type { CvLibrary } from "@/features/candidate-cvs/model";
import type { AccountAssessment } from "@/features/psychometrics/model";
import type { SavedJobs } from "@/features/saved-vacancies/model";
import type { AssessmentResult } from "@/features/candidate/dashboard/assessments";
import { ApplicationsBento, CONTEXT, FOOT_LINK, INLINE_LINK, Ring, SavedTile, Tile, UNIT, VALUE } from "@/features/candidate/dashboard/charts";
import { relativeTime } from "@/features/candidate/dashboard/format";
import { dashboardInsights, isUnread, nextSteps, type Application } from "@/features/candidate/dashboard/insights";
import { NextStep, NextStepSkeleton } from "@/features/candidate/dashboard/next-step";
import { EntranceClock } from "@/features/candidate/dashboard/entrance";
import { SourceError, SourceLoading, useSource, type Source } from "@/features/candidate/dashboard/source";
import { applicationBadge } from "@/features/candidate/saved/application-status";
import { loadApplicationsAction, markMessageReadAction } from "@/features/candidate-applications/actions";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { loadProfileAction } from "@/features/candidate/profile-actions";
import { loadSavedJobsAction } from "@/features/saved-vacancies/actions";
import { cn } from "@/lib/utils";

const loadApplications = () => loadApplicationsAction({ limit: 50 });
type Profile = { profile: ProfileRead | null; languages: ProfileLanguages };
export type CandidateDashboardOverviewProps = { assessments: AssessmentResult };
const RECENT = 5;
/** The canonical status words and paint, shared with the inbox and Guardadas (design/system.md, candidate 6). */
function StatusBadge({ item }: { item: Application }) {
  const { label, variant } = applicationBadge(item);
  return <Badge variant={variant} dot>{label}</Badge>;
}
// Confirmed reads are scoped to the exact visible revision, never a replacement message.
const revision = (item: Application) => `${item.id}:${item.updated_at}`;
const changed = (item: Application) => Date.parse(item.updated_at ?? item.applied_at);

/** «Postulaciones recientes»: the five latest changes, with their status badge and what is pending on each. */
const RecentApplications = memo(function RecentApplications({ source, items, assessments }: { source: Source<ApplicationsPage>; items?: Application[]; assessments?: AccountAssessment[] }) {
  const id = useId();
  const now = new Date();
  const recent = items ? [...items].sort((a, b) => changed(b) - changed(a)).slice(0, RECENT) : [];
  const evaluation = new Map(assessments?.flatMap(item => item.application_id ? [[item.application_id, item] as const] : []));
  const all = items && !(source.result?.ok && source.result.data.next_cursor) && items.length > RECENT ? `Ver las ${items.length}` : "Ver todas";
  return <section aria-labelledby={id} className={cn(CARD, "col-span-2 gap-2 p-4 pb-2 sm:p-6 xl:col-span-8 xl:row-span-2")}>
    <div className="flex min-h-6 items-center justify-between gap-3">
      <h3 id={id} className="text-[15px] leading-[22px] font-semibold">Postulaciones recientes</h3>
      <Link className={buttonVariants({ variant: "ghost", className: "-my-2.5 -mr-3 min-h-10 text-muted-foreground" })} href="/candidato/postulaciones">{all}<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
    </div>
    {!source.result ? <SourceLoading label="Cargando postulaciones" /> : !source.result.ok ? <SourceError failure={source.result} retry={source.retry} label="las postulaciones" /> : !recent.length
      ? <SectionEmpty tone="empty" icon={BriefcaseBusiness} title="Tu primera postulación va aquí" description="Explora vacantes y envía tu CV. Aquí verás cambios de estado y mensajes de las empresas." primaryAction={{ href: "/vacantes", label: "Explorar vacantes" }} />
      : <ol aria-label="Ordenadas por su último cambio" className="divide-y">{recent.map(item => {
        const unread = isUnread(item);
        const pending = evaluation.get(item.id);
        return <li key={item.id} id={`application-${item.id}`} className="grid min-h-15 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              {unread && <span role="img" aria-label="Mensaje sin leer" className="size-2 shrink-0 rounded-full bg-primary-text" />}
              <Link className="min-w-0 break-words underline-offset-3 hover:underline sm:truncate" href="/candidato/postulaciones">{item.vacancy.title}</Link>
            </p>
            <p className="text-xs break-words text-muted-foreground sm:truncate">{item.company.name}{unread ? " · 1 mensaje nuevo" : ""}{pending ? ` · Evaluación ${pending.answered_count}/${pending.total_count}` : ""}</p>
          </div>
          <StatusBadge item={item} />
          <time dateTime={item.updated_at ?? item.applied_at} className="hidden min-w-18 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:block">{relativeTime(item.updated_at ?? item.applied_at, now)}</time>
        </li>;
      })}</ol>}
  </section>;
});

const CHIP = "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] leading-4 font-medium whitespace-nowrap";
const MISSING_CHIPS = 3;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** What companies see, only from sections with real data (profile read + CV library). */
function profileSections(profile: CandidateProfile | null, cvs?: number): string[] {
  if (!profile) return [];
  return [
    [profile.seniority !== null || profile.yearsOfExperience !== null, "Experiencia"],
    [profile.education.length > 0, "Nivel de estudios"],
    [profile.languages.length > 0, "Idiomas"],
    [!!cvs, "CV"],
  ].flatMap(([shown, label]) => shown ? [label as string] : []);
}

/** «Perfil»: a thin brand ring (check when complete, % when not), then what companies see or what is missing. */
const ProfileTile = memo(function ProfileTile({ source, completeness, sections }: { source: Source<Profile>; completeness?: Completeness; sections: string[] }) {
  const percentage = completeness?.percentage ?? 0;
  const complete = percentage === 100;
  const missing = completeness?.missing ?? [];
  const chips = complete ? sections : [...missing.slice(0, MISSING_CHIPS).map(capitalize), ...missing.length > MISSING_CHIPS ? [`+${missing.length - MISSING_CHIPS} más`] : []];
  return <Tile title="Perfil" icon={UserRound} order={3} ready={source.result !== undefined}>
    {!source.result ? <SourceLoading label="Cargando perfil" compact /> : !source.result.ok ? <SourceError failure={source.result} retry={source.retry} label="tu perfil" /> : completeness && <>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
        <div className="row-span-2 self-start"><Ring value={percentage} total={100} size={56} stroke={5} brand label={`Perfil completo al ${percentage} %`}>
          {complete ? <Check data-profile-check className="size-5 text-primary-text" strokeWidth={2.5} /> : <b className="text-[13px] font-semibold tracking-tight tabular-nums">{percentage}%</b>}
        </Ring></div>
        <div className="min-w-0">
          <p className="font-semibold">{complete ? "Perfil completo" : percentage >= 50 ? "Te falta poco" : "Completa tu perfil"}</p>
          <p className={CONTEXT}>{complete ? "Lo que ven las empresas está completo" : `${completeness.completed} de ${completeness.total} datos completos`}</p>
        </div>
        {chips.length > 0 && <ul aria-label={complete ? "Lo que ven las empresas" : "Datos que faltan"} className="col-start-2 flex flex-wrap gap-1">
          {chips.map(chip => <li key={chip} className={cn(CHIP, complete ? "bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))] text-foreground ring-1 ring-primary/15" : "border border-dashed border-border text-muted-foreground")}>
            {complete && <Check aria-hidden="true" className="size-3 shrink-0 text-primary-text" strokeWidth={3} />}{chip}
          </li>)}
        </ul>}
      </div>
      <Link href="/candidato/perfil" className={FOOT_LINK}>{complete ? "Ver perfil" : "Completar perfil"}</Link>
    </>}
  </Tile>;
});

const CvTile = memo(function CvTile({ source }: { source: Source<CvLibrary> }) {
  const data = source.result?.ok ? source.result.data : undefined;
  return <Tile title="CVs" icon={Files} order={4} ready={source.result !== undefined}>
    {!source.result ? <SourceLoading label="Cargando CVs" compact /> : !source.result.ok ? <SourceError failure={source.result} retry={source.retry} label="tus CVs" /> : data && <div>
      <p className={VALUE}>{data.items.length} <small className={UNIT}>de {data.limits.max_cvs}</small></p>
      <p className={CONTEXT}>{data.items.length === 0 ? <>Aún no subes un CV · <Link className={INLINE_LINK} href="/candidato/cvs">Subir CV</Link></>
        : data.items.length >= data.limits.max_cvs ? <>Biblioteca llena · <Link className={INLINE_LINK} href="/candidato/cvs">Ir a mis CVs</Link></>
        : <>{data.items.filter(cv => cv.in_use).length} en uso · <Link className={INLINE_LINK} href="/candidato/cvs">Subir otro</Link></>}</p>
    </div>}
  </Tile>;
});

/**
 * Artboard 04 «Bento con siguiente paso»: «Siguiente paso», then a 12-column bento (hero «Este mes», four tiles,
 * recent applications, profile ring and CVs). Each read is independent; derived figures and the props of the memoized
 * parts keep their identity until their own source changes, so nothing re-renders or re-animates on unrelated updates.
 */
export function CandidateDashboardOverview({ assessments }: CandidateDashboardOverviewProps) {
  const applications = useSource<ApplicationsPage>(loadApplications);
  const cvs = useSource<CvLibrary>(loadCvsAction);
  const profile = useSource<Profile>(loadProfileAction);
  const saved = useSource<SavedJobs>(loadSavedJobsAction);
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set());
  const attempted = useRef(new Set<string>());
  const original = applications.result?.ok ? applications.result.data : undefined;
  const items = useMemo(() => original?.items.map(item => read.has(revision(item)) ? { ...item, message_read_at: item.updated_at } : item), [original, read]);
  const insights = useMemo(() => original ? dashboardInsights(original.items) : undefined, [original]);
  const profileData = profile.result?.ok ? profile.result.data : undefined;
  const candidate = useMemo(() => profileData?.profile ? profileFromWire(profileData.profile, profileData.languages) : null, [profileData]);
  // The ten key data points shared with /candidato/perfil (profile-completeness.ts): the tile and «Siguiente paso».
  const completeness = useMemo(() => profileData ? profileCompleteness(candidate) : undefined, [profileData, candidate]);
  const cvCount = cvs.result?.ok ? cvs.result.data.items.length : undefined;
  const sections = useMemo(() => profileSections(candidate, cvCount), [candidate, cvCount]);
  const eligible = assessments?.ok ? assessments.data.items : undefined;
  const steps = useMemo(() => nextSteps({ assessments: eligible, applications: items, profile: completeness }), [eligible, items, completeness]);
  // A failed source contributes nothing; the card waits until each pending source answered, so it never jumps.
  const settled = assessments !== undefined && applications.result !== undefined && profile.result !== undefined;
  const retryApplications = applications.retry;
  const onRead = useCallback((item: Application) => {
    const token = revision(item);
    if (!isUnread(item) || !item.updated_at || attempted.current.has(token)) return;
    attempted.current.add(token);
    void markMessageReadAction(item.id, { updated_at: item.updated_at }).then(result => {
      if (result.ok) setRead(previous => new Set(previous).add(token));
      else if (result.reference.status === 409 && result.reference.code === "message_changed") retryApplications();
    }, () => { /* A read acknowledgment must never interrupt reading or retry itself. */ });
  }, [retryApplications]);
  return <EntranceClock><div className="flex min-w-0 flex-col gap-3 sm:gap-6">
    {settled ? <NextStep steps={steps} onRead={onRead} /> : assessments && <NextStepSkeleton label="Cargando siguiente paso" />}
    {original?.next_cursor && <p role="note" className="text-xs text-muted-foreground">Resumen de las últimas {original.items.length} postulaciones. Consulta todas en Postulaciones.</p>}
    <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-6 xl:auto-rows-[minmax(176px,auto)] xl:grid-cols-12">
      <ApplicationsBento source={applications} insights={insights} />
      <SavedTile source={saved} />
      <RecentApplications source={applications} items={items} assessments={eligible} />
      <div className="col-span-2 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6 xl:col-span-4 xl:row-span-2 xl:grid-cols-1">
        <ProfileTile source={profile} completeness={completeness} sections={sections} />
        <CvTile source={cvs} />
      </div>
    </div>
  </div></EntranceClock>;
}
