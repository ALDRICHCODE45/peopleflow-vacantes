import Link from "next/link"

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

/** Supplemental status color; the Spanish status text always carries the meaning. */
const STATUS_DOT: Readonly<Record<ApplicationStatus, string>> = { submitted: "bg-chart-3", in_review: "bg-primary", hired: "bg-chart-2", rejected: "bg-destructive" }

/** Shared link contract: at least a 40px hit target plus a visible focus ring. */
const LINK_CLASS = "inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-primary underline-offset-4 outline-hidden transition-colors hover:text-primary/80 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"

/** Most recent applications first, as a copy so the props array is never reordered. */
const recentApplications = (applications: readonly CandidateApplicationView[]): readonly CandidateApplicationView[] =>
  [...applications].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 3)

/** One compact metric tile. */
function Metric({ label, value, detail }: Readonly<{ label: string; value: string; detail: string }>) {
  return (
    <div data-pf-overview-metric={label} className="rounded-2xl border border-border bg-card/60 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-3xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
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

  return (
    <div data-pf-candidate-overview className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <section aria-labelledby="candidate-overview-welcome" className="flex flex-col gap-1">
        <h2 id="candidate-overview-welcome" className="font-heading text-2xl font-semibold text-foreground">Hola, {firstName}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {`Tienes ${countLabel(total, "postulación registrada", "postulaciones registradas")} y ${inProcess} en proceso. Tu perfil está al ${completeness.percentage}% y tienes ${countLabel(cvTotal, "CV disponible", "CVs disponibles")}.`}
        </p>
        <p role="note" data-pf-candidate-overview-disclosure className="max-w-3xl text-sm text-muted-foreground">
          Demo local: esta vista usa solo datos de ejemplo y no guarda cambios ni envía información.
        </p>
      </section>

      <section aria-label="Resumen de tu búsqueda" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Postulaciones" value={String(total)} detail={countLabel(total, "postulación registrada", "postulaciones registradas")} />
        <Metric label="En proceso" value={String(inProcess)} detail="Enviadas o en revisión" />
        <Metric label="Perfil completo" value={`${completeness.percentage}%`} detail={`${completeness.completed} de ${completeness.total} campos completados`} />
        <Metric label="CVs" value={String(cvTotal)} detail={cvTotal === 0 ? "Sin CVs disponibles" : countLabel(cvTotal, "CV disponible", "CVs disponibles")} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section aria-labelledby="candidate-overview-recent" data-pf-recent-applications className="rounded-2xl border border-border bg-card/60 p-4 md:p-6 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="candidate-overview-recent" className="font-heading text-base font-semibold text-foreground">Postulaciones recientes</h2>
            <Link href="/candidato/postulaciones" className={LINK_CLASS}>Ver todas mis postulaciones</Link>
          </div>
          {recent.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Todavía no tienes postulaciones. Aquí verás tus envíos recientes.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {recent.map((application) => (
                <li key={application.id} className="flex flex-col gap-2 rounded-xl border border-border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{application.jobTitle}</p>
                    <p className="text-sm text-muted-foreground">{application.companyName}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-2 text-sm text-foreground">
                      <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT[application.status]}`} />
                      {APPLICATION_STATUS_LABELS[application.status]}
                    </span>
                    <span className="text-sm text-muted-foreground">Actualizada el {formatDate(application.updatedAt)}</span>
                    {application.publicJobHref ? (
                      <Link href={application.publicJobHref} aria-label={`Ver vacante de ${application.jobTitle} en ${application.companyName}`} className={LINK_CLASS}>Ver vacante</Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">Vacante histórica sin enlace</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="candidate-overview-status" data-pf-status-breakdown className="rounded-2xl border border-border bg-card/60 p-4 md:p-6">
          <h2 id="candidate-overview-status" className="font-heading text-base font-semibold text-foreground">Estado de tus postulaciones</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {APPLICATION_STATUSES.map((status) => (
              <li key={status} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-sm text-foreground">
                  <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
                  {APPLICATION_STATUS_LABELS[status]}
                </span>
                <span className="text-sm font-medium tabular-nums text-foreground">{counts[status]}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="candidate-overview-profile" data-pf-profile-guidance className="rounded-2xl border border-border bg-card/60 p-4 md:p-6">
          <h2 id="candidate-overview-profile" className="font-heading text-base font-semibold text-foreground">Tu perfil</h2>
          {completeness.percentage === 100 ? (
            <p className="mt-3 text-sm text-muted-foreground">Tu perfil está listo. Completaste los {completeness.total} campos clave.</p>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">
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
          <Link href="/candidato/perfil" className={`${LINK_CLASS} mt-3`}>Revisar mi perfil</Link>
        </section>

        <section aria-labelledby="candidate-overview-cvs" data-pf-cv-snapshot className="rounded-2xl border border-border bg-card/60 p-4 md:p-6">
          <h2 id="candidate-overview-cvs" className="font-heading text-base font-semibold text-foreground">Tus CVs</h2>
          {cvTotal === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Todavía no tienes CVs disponibles. Este portafolio local no permite subir archivos.</p>
          ) : primary ? (
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Documento principal</dt><dd className="text-foreground">{primary.label}</dd></div>
              <div><dt className="text-muted-foreground">Archivo</dt><dd className="break-all text-foreground">{primary.fileName}</dd></div>
              <div><dt className="text-muted-foreground">Idioma</dt><dd className="text-foreground">{CV_LANGUAGE_LABELS[primary.language]}</dd></div>
              <div><dt className="text-muted-foreground">Tamaño</dt><dd className="text-foreground">{formatFileSize(primary.sizeBytes)}</dd></div>
              <div><dt className="text-muted-foreground">Actualizado</dt><dd className="text-foreground">{formatDate(primary.updatedAt)}</dd></div>
              <div><dt className="text-muted-foreground">CVs en tu portafolio</dt><dd className="text-foreground">{countLabel(cvTotal, "CV", "CVs")}</dd></div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Tienes {countLabel(cvTotal, "CV", "CVs")}, pero ninguno está marcado como principal.</p>
          )}
          <Link href="/candidato/cvs" className={`${LINK_CLASS} mt-3`}>Ver mis CVs</Link>
        </section>
      </div>
    </div>
  )
}
