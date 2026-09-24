import Link from "next/link"
import { ArrowUpRight, BriefcaseBusiness, CircleCheckBig, Clock3, FileText, Files, Link2Off } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Badge, type BadgeVariant } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"

import type { CandidateIdentity, CandidateProfile } from "@/features/candidate/model"
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABELS, CV_LANGUAGE_LABELS, applicationInProcessCount, applicationTotalCount, countApplicationsByStatus, summarizeCvs } from "@/features/candidate/portfolio-model"
import type { ApplicationStatus, CandidateApplicationView, CandidateCv } from "@/features/candidate/portfolio-model"

/** Props-only candidate dashboard overview: every number derives from the passed
    identity/profile/applications/CVs, with no fetch, storage, navigation, timer or
    randomness. It is a server component; CDP-05 supplies the frozen fixtures. */
export type CandidateDashboardOverviewProps = Readonly<{
  identity: CandidateIdentity
  profile: CandidateProfile
  applications: readonly CandidateApplicationView[]
  cvs: readonly CandidateCv[]
}>

/** One bounded checklist entry: a Spanish label plus its completeness predicate. */
type ProfileCheck = readonly [label: string, isFilled: (profile: CandidateProfile) => boolean]

/** Transparent, bounded checklist of meaningful existing profile fields, so no
    arbitrary server-side completeness claim is invented. A field is complete when
    it is present (`!== null`) or a non-empty collection. */
const PROFILE_CHECKS: readonly ProfileCheck[] = [
  ["Título profesional", (profile) => profile.professionalTitle !== null],
  ["Resumen profesional", (profile) => profile.summary !== null],
  ["Teléfono de contacto", (profile) => profile.phone !== null],
  ["Ciudad", (profile) => profile.city !== null],
  ["País", (profile) => profile.country !== null],
  ["Nivel educativo", (profile) => profile.educationLevel !== null],
  ["Área de estudio", (profile) => profile.fieldOfStudy !== null],
  ["Años de experiencia", (profile) => profile.yearsOfExperience !== null],
  ["Habilidades", (profile) => profile.skills.length > 0],
  ["Idiomas", (profile) => profile.languages.length > 0],
  ["LinkedIn", (profile) => profile.linkedinUrl !== null],
  ["Portafolio", (profile) => profile.portfolioUrl !== null],
  ["Expectativa salarial", (profile) => profile.expectedSalary !== null],
]

/** Honest derived score: counts, rounded percentage and missing Spanish labels. */
export type ProfileCompleteness = Readonly<{ completed: number; total: number; percentage: number; missing: readonly string[] }>

/** Pure profile-completeness score: it walks {@link PROFILE_CHECKS} over the
    passed profile, reports incomplete profiles honestly, and mutates nothing. */
export function profileCompleteness(profile: CandidateProfile): ProfileCompleteness {
  const missing = PROFILE_CHECKS.filter(([, isFilled]) => !isFilled(profile)).map(([label]) => label)
  const total = PROFILE_CHECKS.length, completed = total - missing.length
  return { completed, total, percentage: Math.round((completed / total) * 100), missing }
}

/** Deterministic Mexico Spanish date (UTC) and deterministic KB/MB size text. */
const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
const DECIMAL_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 })
const formatDate = (value: string): string => DATE_FORMAT.format(new Date(value))
const formatFileSize = (bytes: number): string => bytes >= 1024 * 1024 ? `${DECIMAL_FORMAT.format(bytes / 1024 / 1024)} MB` : `${DECIMAL_FORMAT.format(Math.round(bytes / 1024))} KB`
/** Natural Spanish count: singular only for exactly one. */
const countLabel = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`

/**
 * Canonical semantic status variants: the Spanish label always carries the
 * meaning and the shared Badge variant reinforces it through the `--status-*`
 * tokens. No legacy grayscale/violet token and no raw color value is authored
 * here.
 */
const STATUS_VARIANT: Readonly<Record<ApplicationStatus, BadgeVariant>> = {
  submitted: "info",
  in_review: "review",
  hired: "success",
  rejected: "danger",
}
/** The same four tokens paint the proportional bar segments and legend dots. */
const STATUS_BAR: Readonly<Record<ApplicationStatus, string>> = {
  submitted: "bg-status-info",
  in_review: "bg-status-review",
  hired: "bg-status-success",
  rejected: "bg-status-danger",
}

/**
 * Navigation keeps the anchor element and its link role: the shadcn Button
 * variants, focus ring and 40px target are applied to the Next Link instead of
 * routing it through the Base UI Button, which would relabel the navigation.
 */
const PRIMARY_LINK = buttonVariants({ size: "sm", className: "min-h-10" })
const OUTLINE_LINK = buttonVariants({ variant: "outline", size: "sm", className: "min-h-10" })
const QUIET_LINK = buttonVariants({ variant: "ghost", size: "sm", className: "min-h-10" })

/** Quiet field term: it never competes with the value it labels. */
const META = "text-[12.5px] font-medium text-muted-foreground"

/** Most recent applications first, as a copy so the props array is never reordered. */
const recentApplications = (applications: readonly CandidateApplicationView[]): readonly CandidateApplicationView[] =>
  [...applications].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 3)

/** Circular contextual medallion: the icon anchors the identity of a metric or row. */
function Medallion({ icon: Icon }: Readonly<{ icon: LucideIcon }>) {
  return (
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
      <Icon className="size-4" />
    </span>
  )
}

/** Status as text inside its semantic variant: the Spanish label carries the
    meaning and the shared decorative dot only supplements it. */
function StatusBadge({ status }: Readonly<{ status: ApplicationStatus }>) {
  return <Badge variant={STATUS_VARIANT[status]} dot>{APPLICATION_STATUS_LABELS[status]}</Badge>
}

/** One derived KPI tile: icon medallion, exact label, tabular value and detail. */
type OverviewMetric = Readonly<{ label: string; icon: LucideIcon; value: string; detail: string }>
function MetricCard({ label, icon: Icon, value, detail }: OverviewMetric) {
  return (
    <Card size="sm" data-pf-overview-metric={label}>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <Medallion icon={Icon} />
          <CardTitle className={META}>{label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p data-pf-overview-metric-value className="font-heading text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        <p className={META}>{detail}</p>
      </CardContent>
    </Card>
  )
}

/** One recent application as a compact grouped-list row: the semantic `<ul>`
    owns the dividers, so the Item itself is a quiet `size="sm"` surface with no
    per-row mini-card. Identity and its status/date metadata share one wrapping
    `ItemContent` with the native `line-clamp-1` removed, so the title soft-wraps
    instead of being squeezed by `ItemActions`, which keeps only the truthful live
    vacancy link or the honest historical note. */
function RecentApplicationRow({ application }: Readonly<{ application: CandidateApplicationView }>) {
  return (
    <li data-pf-recent-row={application.id} className="min-w-0">
      <Item size="sm" className="min-w-0 items-start rounded-none px-0 py-3">
        <ItemMedia><Medallion icon={BriefcaseBusiness} /></ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="line-clamp-none block w-full">
            <h4 className="font-heading text-sm font-semibold text-foreground">{application.jobTitle}</h4>
          </ItemTitle>
          <ItemDescription className="break-words">{application.companyName}</ItemDescription>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
            <StatusBadge status={application.status} />
            <span className="text-sm text-muted-foreground">
              Actualizada el <time dateTime={application.updatedAt}>{formatDate(application.updatedAt)}</time>
            </span>
          </div>
        </ItemContent>
        <ItemActions className="w-full sm:w-auto">
          {application.publicJobHref === null ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Link2Off aria-hidden="true" className="size-4" />
              Vacante histórica sin enlace
            </span>
          ) : (
            <Link href={application.publicJobHref} aria-label={`Ver vacante de ${application.jobTitle} en ${application.companyName}`} className={OUTLINE_LINK}>
              Ver vacante
              <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          )}
        </ItemActions>
      </Item>
    </li>
  )
}

export function CandidateDashboardOverview({ identity, profile, applications, cvs }: CandidateDashboardOverviewProps) {
  const counts = countApplicationsByStatus(applications)
  const total = applicationTotalCount(counts), inProcess = applicationInProcessCount(counts)
  const completeness = profileCompleteness(profile)
  const { total: cvTotal, primary } = summarizeCvs(cvs)
  const recent = recentApplications(applications)
  const firstName = identity.fullName.trim().split(/\s+/u)[0] ?? identity.fullName
  const missingCount = completeness.missing.length
  const metrics: readonly OverviewMetric[] = [
    { label: "Postulaciones", icon: BriefcaseBusiness, value: String(total), detail: countLabel(total, "postulación registrada", "postulaciones registradas") },
    { label: "En proceso", icon: Clock3, value: String(inProcess), detail: "Enviadas o en revisión" },
    { label: "Perfil completo", icon: CircleCheckBig, value: `${completeness.percentage}%`, detail: `${completeness.completed} de ${completeness.total} campos completados` },
    { label: "CVs", icon: Files, value: String(cvTotal), detail: cvTotal === 0 ? "Sin CVs disponibles" : countLabel(cvTotal, "CV disponible", "CVs disponibles") },
  ]

  return (
    <div data-pf-candidate-overview className="mx-auto w-full max-w-screen-2xl @container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div data-pf-candidate-overview-inner className="flex w-full flex-col gap-4 md:gap-6">
        <section aria-labelledby="candidate-overview-welcome" className="flex flex-col gap-1">
          <h2 id="candidate-overview-welcome" className="font-heading text-2xl font-semibold text-foreground">Hola, {firstName}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {`Tienes ${countLabel(total, "postulación registrada", "postulaciones registradas")} y ${inProcess} en proceso. Tu perfil está al ${completeness.percentage}% y tienes ${countLabel(cvTotal, "CV disponible", "CVs disponibles")}.`}
          </p>
        </section>

        <section aria-label="Resumen de tu búsqueda" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (<MetricCard key={metric.label} {...metric} />))}
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section aria-labelledby="candidate-overview-recent" data-pf-recent-applications className="lg:col-span-2">
            <Card size="sm" className="h-full">
              <CardHeader>
                <h3 id="candidate-overview-recent" className="font-heading text-base font-semibold text-foreground">Postulaciones recientes</h3>
                <CardDescription className="col-start-1 row-start-2">Tus últimos envíos, ordenados por actualización.</CardDescription>
                <CardAction className="max-sm:col-span-2 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:justify-self-start">
                  <Link href="/candidato/postulaciones" aria-label="Ver todas mis postulaciones" className={QUIET_LINK}>Ver todas</Link>
                </CardAction>
              </CardHeader>
              <CardContent>
                {recent.length === 0 ? (
                  <Empty className="border border-dashed border-border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><BriefcaseBusiness aria-hidden="true" /></EmptyMedia>
                      <EmptyTitle>Sin postulaciones</EmptyTitle>
                      <EmptyDescription>Todavía no tienes postulaciones. Aquí verás tus envíos recientes.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {recent.map((application) => (<RecentApplicationRow key={application.id} application={application} />))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="candidate-overview-status" data-pf-status-breakdown>
            <Card size="sm" className="h-full">
              <CardHeader>
                <h3 id="candidate-overview-status" className="font-heading text-base font-semibold text-foreground">Estado de tus postulaciones</h3>
                <CardDescription>{countLabel(total, "postulación registrada", "postulaciones registradas")} en total.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div data-pf-status-bar aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                  {APPLICATION_STATUSES.map((status) => (
                    <span key={status} data-pf-status-segment={status} className={`basis-0 ${STATUS_BAR[status]}`} style={{ flexGrow: counts[status] }} />
                  ))}
                </div>
                <ul className="flex flex-col gap-2">
                  {APPLICATION_STATUSES.map((status) => (
                    <li key={status} className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-sm text-foreground">
                        <span aria-hidden="true" className={`size-2.5 rounded-full ${STATUS_BAR[status]}`} />
                        {APPLICATION_STATUS_LABELS[status]}
                      </span>
                      <span className="text-sm font-medium tabular-nums text-foreground">{counts[status]}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section aria-labelledby="candidate-overview-profile" data-pf-profile-guidance>
            <Card size="sm" className="h-full">
              <CardHeader>
                <h3 id="candidate-overview-profile" className="font-heading text-base font-semibold text-foreground">Tu perfil</h3>
                <CardAction>
                  <Badge variant={completeness.percentage === 100 ? "success" : "review"}>
                    {completeness.percentage === 100 ? "Completo" : "Incompleto"}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Progress value={completeness.percentage} aria-label="Perfil completo" className="w-full">
                  <ProgressLabel>Perfil completo</ProgressLabel>
                  <ProgressValue />
                </Progress>
                <p className="text-sm text-muted-foreground">{`${completeness.completed} de ${completeness.total} campos completados`}</p>
                {completeness.percentage === 100 ? (
                  <p className="text-sm text-muted-foreground">Tu perfil está listo. Completaste los {completeness.total} campos clave.</p>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    <p>Tu perfil está al {completeness.percentage}%. {missingCount === 1 ? "Te falta 1 campo:" : `Te faltan ${missingCount} campos:`}</p>
                    <ul className="mt-2 flex flex-col gap-1">
                      {completeness.missing.map((label) => (
                        <li key={label} className="flex items-center gap-2 text-foreground">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                          {label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
              <CardFooter>
                <Link href="/candidato/perfil" className={PRIMARY_LINK}>Revisar mi perfil</Link>
              </CardFooter>
            </Card>
          </section>

          <section aria-labelledby="candidate-overview-cvs" data-pf-cv-snapshot>
            <Card size="sm" className="h-full">
              <CardHeader>
                <h3 id="candidate-overview-cvs" className="font-heading text-base font-semibold text-foreground">Tus CVs</h3>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {cvTotal === 0 ? (
                  <Empty className="border border-dashed border-border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><Files aria-hidden="true" /></EmptyMedia>
                      <EmptyTitle>Sin CVs</EmptyTitle>
                      <EmptyDescription>Cuando agregues un CV, vas a ver aquí su información.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : primary === undefined ? (
                  <p className="text-sm text-muted-foreground">Tienes {countLabel(cvTotal, "CV", "CVs")}, pero ninguno está marcado como principal.</p>
                ) : (
                  <>
                    <Item size="sm" variant="muted">
                      <ItemMedia><Medallion icon={FileText} /></ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="line-clamp-none block w-full">
                          <h4 className="font-heading text-sm font-semibold text-foreground">CV principal</h4>
                        </ItemTitle>
                        <ItemDescription className="line-clamp-none break-words">{primary.fileName}</ItemDescription>
                      </ItemContent>
                      <ItemActions className="w-full sm:w-auto">
                        <Badge variant="accent">Principal</Badge>
                      </ItemActions>
                    </Item>
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      <div><dt className="text-muted-foreground">Idioma</dt><dd className="text-foreground">{CV_LANGUAGE_LABELS[primary.language]}</dd></div>
                      <div><dt className="text-muted-foreground">Tamaño</dt><dd className="text-foreground">{formatFileSize(primary.sizeBytes)}</dd></div>
                      <div><dt className="text-muted-foreground">Actualizado</dt><dd className="text-foreground"><time dateTime={primary.updatedAt}>{formatDate(primary.updatedAt)}</time></dd></div>
                      <div><dt className="text-muted-foreground">CVs en tu portafolio</dt><dd className="text-foreground">{countLabel(cvTotal, "CV", "CVs")}</dd></div>
                    </dl>
                  </>
                )}
              </CardContent>
              <CardFooter>
                <Link href="/candidato/cvs" className={PRIMARY_LINK}>Ver mis CVs</Link>
              </CardFooter>
            </Card>
          </section>
        </div>
      </div>
    </div>
  )
}
