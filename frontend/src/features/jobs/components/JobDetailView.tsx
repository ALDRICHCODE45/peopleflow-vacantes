import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BookmarkIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarClockIcon,
  CalendarHeartIcon,
  ChevronRightIcon,
  ClockIcon,
  GlobeIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  LaptopIcon,
  LayoutGridIcon,
  LinkIcon,
  MailIcon,
  MapPinIcon,
  Share2Icon,
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";

import { findCompanyProfile } from "../../company-profile/model";
import { PROTOTYPE_COMPANY_PROFILES } from "../../company-profile/prototype-companies";
import type { PrototypeJobView } from "../enrich";
import {
  employmentTypeLabel,
  formatClosingDate,
  formatPublishedDate,
  formatSalary,
  payFrequencyLabel,
  seniorityLabel,
  workModeLabel,
} from "../formatters";
import { CompanyMonogram, PrototypeDisclosure, VerifiedByPeopleFlow, prototypeApplicantsLabel, prototypeResponseLabel } from "./prototype-ui";

/** Contextual icon per wire work mode, mirroring the public board rows. */
const WORK_MODE_ICONS = {
  onsite: MapPinIcon,
  remote: GlobeIcon,
  hybrid: Building2Icon,
} as const satisfies Record<PrototypeJobView["work_mode"], typeof MapPinIcon>;

const cardSurface = "rounded-2xl border border-border bg-card/60";
const featuredBadge = "rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-foreground";
const statTile = "grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-foreground";
const statValue = "break-words font-medium text-foreground";
const metaValue = "mt-0.5 font-medium break-words text-foreground";
const focusRing =
  "rounded-md transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/* Body links keep `text-foreground` with an always-visible underline, because the accent token fails AA for body text on the dark page background. */
const bodyLink =
  "font-medium text-foreground underline decoration-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** Primary apply affordance: a token tint, disabled until R5 wires real feedback. */
const actionPrimary = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-4 text-sm font-semibold text-foreground disabled:opacity-70";
/** Secondary save affordance, equally inert in this slice. */
const actionGhost = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-muted-foreground disabled:opacity-60";
const shareButton =
  "grid h-10 flex-1 place-items-center rounded-lg border border-border bg-background text-muted-foreground disabled:opacity-60";
/** One benefit tile: tinted token surface, decorative icon, and complete safe text. */
const benefitTile =
  "flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card/60 p-3 text-sm text-muted-foreground";
const benefitIconTile = "grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-foreground";
/**
 * Benefits are free fictional text, so the icon is chosen by a small keyword
 * rule and always falls back to the generic mark. Every rule and every tile
 * stays inside the semantic token layer: no raw palette color, no inline style.
 */
const BENEFIT_ICON_RULES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly Icon: typeof SparklesIcon;
}> = [
  { pattern: /salud|m[ée]dic|seguro|cobertura/i, Icon: HeartPulseIcon },
  { pattern: /vacacion|libre|flexib|horario|descanso/i, Icon: CalendarHeartIcon },
  { pattern: /remoto|hogar|casa|distancia|h[ií]brido/i, Icon: GlobeIcon },
  { pattern: /capacit|formaci|educac|curso|presupuesto|estudio/i, Icon: GraduationCapIcon },
  { pattern: /equipo|c[oó]mputo|hardware|herramienta/i, Icon: LaptopIcon },
];

function benefitIcon(benefit: string): typeof SparklesIcon {
  return BENEFIT_ICON_RULES.find(({ pattern }) => pattern.test(benefit))?.Icon ?? SparklesIcon;
}

/** Non-persistent share affordances: three inert icon buttons in the rail. */
const SHARE_ACTIONS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly Icon: typeof LinkIcon;
}> = [
  { key: "link", label: "Copiar enlace", Icon: LinkIcon },
  { key: "share", label: "Compartir en redes", Icon: Share2Icon },
  { key: "mail", label: "Enviar por correo", Icon: MailIcon },
];

/**
 * Splits the validated description on blank lines into paragraphs; single
 * line breaks stay inside one paragraph as preserved text. Everything renders
 * as safe React plain text — no HTML interpretation of description content.
 */
function DescriptionParagraphs({ description }: { description: string }) {
  const paragraphs = description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return (
    <div className="space-y-4">
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className="whitespace-pre-line text-[15px] leading-relaxed text-muted-foreground"
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}

/**
 * The prototype profile a vacancy may link to: a profile is only eligible once
 * the prototype enrichment knows the vacancy, and only an exact profile id or
 * exact source-name match resolves. Everything else stays byte-honest.
 */
function prototypeProfile(job: PrototypeJobView) {
  if (job.prototype === undefined) return undefined;
  return findCompanyProfile(PROTOTYPE_COMPANY_PROFILES, {
    id: job.company.id,
    name: job.company.name,
  });
}

/**
 * Disclosed prototype role block, rendered after the wire description. Every
 * value is fictional demo enrichment, so the block never fuses with the wire
 * metadata: it carries no image and no paragraph (the description paragraphs
 * stay the article's only `p` elements), and every requirement, skill, and
 * benefit renders as escaped plain text. The block is an h2 sibling of the
 * page's other sections, with its own groups as h3 and the two requirement
 * lists as h4, so the page keeps one unbroken outline. The skills and the
 * benefits follow the committed reference structure: skills are chips and
 * benefits are one tile per benefit, each on a semantic token surface.
 */
function PrototypeRoleSection({ job }: { job: PrototypeJobView }) {
  const prototype = job.prototype;
  if (prototype === undefined) return null;
  const closingDate =
    prototype.closingDate === undefined
      ? null
      : formatClosingDate(prototype.closingDate);

  return (
    <section
      aria-labelledby="prototipo-vacante"
      data-detail-card="prototype"
      className="flex flex-col gap-6 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-6 md:p-7"
    >
      <div className="flex flex-col gap-3">
        <h2
          id="prototipo-vacante"
          className="font-heading text-lg font-semibold text-foreground"
        >
          Prototipo · {prototype.department}
        </h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Frecuencia de pago</dt>
            <dd className="font-medium text-foreground">
              {payFrequencyLabel(prototype.payFrequency)}
            </dd>
          </div>
          {closingDate !== null && (
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">Cierre de postulaciones</dt>
              <dd className="font-medium text-foreground">{closingDate}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="font-heading text-base font-semibold text-foreground">
          Requisitos
        </h3>
        <h4 className="text-sm font-semibold text-foreground">Indispensables</h4>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {prototype.requiredRequirements.map((requirement) => (
            <li
              key={requirement}
              className="border-l-2 border-primary/40 pl-3 leading-relaxed"
            >
              {requirement}
            </li>
          ))}
        </ul>
        <h4 className="mt-1 text-sm font-semibold text-foreground">Deseables</h4>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {prototype.preferredRequirements.map((requirement) => (
            <li
              key={requirement}
              className="border-l-2 border-primary/40 pl-3 leading-relaxed"
            >
              {requirement}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="font-heading text-base font-semibold text-foreground">
          Habilidades
        </h3>
        <ul className="flex flex-wrap gap-2">
          {prototype.skills.map((skill) => (
            <li
              key={skill}
              className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground"
            >
              {skill}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="font-heading text-base font-semibold text-foreground">
          Beneficios
        </h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {prototype.benefits.map((benefit) => {
            const Icon = benefitIcon(benefit);
            return (
              <li key={benefit} data-benefit-tile className={benefitTile}>
                <span aria-hidden="true" className={benefitIconTile}>
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0 break-words">{benefit}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * Server-rendered validated detail view in the reference composition: the
 * breadcrumb to the canonical board, the identity header (monogram, title,
 * featured state, company, wire and prototype metadata, prototype disclosure),
 * four stat cards, the structured prototype role content (requirements, skill
 * chips, and token-only benefit tiles), and the responsive content/sticky-rail
 * scaffold. Only the wire description renders as `p` elements: every other
 * text node is a span, term, or definition. The company links to its canonical
 * profile only under the same exact opt-in match as the disclosed prototype
 * block; the rail carries the wire salary, the explicitly disabled prototype
 * apply/save/share affordances, and the profile context, and it is omitted
 * entirely when neither salary nor an exact profile resolves. No client
 * directive, hook, request, storage, or business mutation is involved here.
 */
export function JobDetailView({ job }: { job: PrototypeJobView }) {
  const prototype = job.prototype;
  const profile = prototypeProfile(job);
  const salary =
    job.salary_min !== undefined || job.salary_max !== undefined
      ? formatSalary({
          min: job.salary_min,
          max: job.salary_max,
          currency: job.salary_currency,
        })
      : null;
  /* Labeled terms instead of one separator line, so the relative prototype label never fuses with the wire publication date. */
  const meta = [
    { key: "location", label: "Ubicación", Icon: MapPinIcon, value: job.location },
    {
      key: "published",
      label: "Publicada",
      Icon: CalendarClockIcon,
      value: job.published_at === undefined ? undefined : formatPublishedDate(job.published_at),
    },
    { key: "relative", label: "Publicación", Icon: ClockIcon, value: prototype?.publishedAgoLabel },
    {
      key: "applicants",
      label: "Postulantes",
      Icon: UsersIcon,
      value: prototype === undefined ? undefined : prototypeApplicantsLabel(prototype.applicantCount),
    },
  ].filter((item) => item.value !== undefined);
  const stats = [
    { key: "modality", label: "Modalidad", Icon: WORK_MODE_ICONS[job.work_mode], value: workModeLabel(job.work_mode) },
    { key: "schedule", label: "Jornada", Icon: BriefcaseIcon, value: employmentTypeLabel(job.employment_type) },
    {
      key: "experience",
      label: "Experiencia",
      Icon: TrendingUpIcon,
      value: prototype?.experienceLabel ?? seniorityLabel(job.seniority),
    },
    { key: "area", label: "Área", Icon: LayoutGridIcon, value: prototype?.department ?? "Sin especificar" },
  ];

  return (
    <article className="flex w-full flex-col gap-6">
      {/* Breadcrumb: the canonical board link plus the current title; truncation protects 375px and the link keeps the return-path accessible name. */}
      <nav aria-label="Ruta de navegación" className="text-sm text-muted-foreground">
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <li className="flex min-w-0 items-center gap-1.5">
            <Link href="/vacantes" aria-label="Volver a vacantes" className={`${focusRing} inline-flex min-h-10 items-center gap-1.5`}>
              <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0" />Vacantes
            </Link>
            <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
          </li>
          <li className="min-w-0" aria-current="page"><span className="block truncate">{job.title}</span></li>
        </ol>
      </nav>

      <header data-detail-region="header" className={`${cardSurface} p-6 md:p-7`}>
        <div className="flex items-start gap-4">
          <CompanyMonogram name={job.company.name} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <h1 className="min-w-0 break-words font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">{job.title}</h1>
              {prototype?.featured === true && <span data-detail-flag="featured" className={featuredBadge}>Destacada</span>}
            </div>
            <div className="text-sm text-muted-foreground">
              {profile === undefined ? (
                <span>{job.company.name}</span>
              ) : (
                <Link href={`/empresas/${profile.companyId}`} className={`${bodyLink} text-sm`}>{job.company.name}</Link>
              )}
            </div>
            {meta.length > 0 && (
              <dl className="flex flex-wrap gap-x-8 gap-y-3">
                {meta.map(({ key, label, Icon, value }) => (
                  <div key={key} data-detail-meta={key}>
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon aria-hidden="true" className="size-3.5 shrink-0" />{label}
                    </dt>
                    <dd className={metaValue}>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {prototype !== undefined && (
              <div id="proceso-prototipo">
                <PrototypeDisclosure />
              </div>
            )}
          </div>
        </div>
      </header>

      <dl data-detail-region="stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ key, label, Icon, value }) => (
          <div key={key} data-detail-stat={key} className={`${cardSurface} flex flex-col gap-2 p-4`}>
            <dt className="flex items-center gap-2 text-xs text-muted-foreground">
              <span aria-hidden="true" className={statTile}><Icon className="size-3.5" /></span>{label}
            </dt>
            <dd className={statValue}>{value}</dd>
          </div>
        ))}
      </dl>

      {/* Responsive scaffold: one content column with the rail beside it from `lg` up. The rail becomes sticky inside its grid area at desktop and stacks back into normal flow below `lg`. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div data-detail-region="content" className="flex min-w-0 flex-col gap-6">
          <section className={`${cardSurface} bg-card/40 p-6 md:p-7`}>
            <h2 className="font-heading text-xl font-semibold text-foreground">Sobre la vacante</h2>
            <div className="mt-4"><DescriptionParagraphs description={job.description} /></div>
          </section>
          <PrototypeRoleSection job={job} />
        </div>

        {(salary !== null || profile !== undefined) && (
          <aside data-detail-region="rail" className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
            {salary !== null && (
              <dl data-detail-card="salary" className={`${cardSurface} flex flex-col gap-1 p-6`}>
                <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <BanknoteIcon aria-hidden="true" className="size-3.5 shrink-0" />Salario
                </dt>
                <dd className="font-heading text-2xl font-bold tracking-tight text-foreground">{salary}</dd>
              </dl>
            )}

            {prototype !== undefined && (
              <section data-detail-card="actions" className={`${cardSurface} flex flex-col gap-3 p-6`}>
                <h3 className="text-sm font-semibold text-foreground">Postulación</h3>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ZapIcon aria-hidden="true" className="size-4 shrink-0" />
                  {prototypeResponseLabel(prototype.responseTimeDays)}
                </span>
                <button type="button" disabled aria-disabled="true" aria-label="Postularme (solo demostración)" aria-describedby="proceso-prototipo" title="Postularme (solo demostración)" className={actionPrimary}>
                  Postularme
                  <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0" />
                </button>
                <button type="button" disabled aria-disabled="true" aria-label="Guardar vacante (solo demostración)" aria-describedby="proceso-prototipo" title="Guardar vacante (solo demostración)" className={actionGhost}>
                  <BookmarkIcon aria-hidden="true" className="size-4 shrink-0" />
                  Guardar
                </button>
                {prototype.verifiedByPeopleFlow && <VerifiedByPeopleFlow />}
              </section>
            )}

            {profile !== undefined && (
              <section data-detail-card="company" className={`${cardSurface} flex flex-col gap-3 bg-card/40 p-6`}>
                <strong className="text-xs font-semibold tracking-wide text-foreground uppercase">{profile.disclosure.label}</strong>
                <div className="flex items-center gap-3">
                  <CompanyMonogram name={profile.name} size="compact" />
                  <div className="min-w-0">
                    <h3 className="font-heading text-base font-semibold text-foreground">{profile.name}</h3>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <span>{profile.companySize}</span>
                      <span aria-hidden="true">·</span>
                      <span>{profile.location}</span>
                    </span>
                  </div>
                </div>
                <div className="text-sm leading-relaxed text-muted-foreground">{profile.disclosure.statement}</div>
                <Link href={`/empresas/${profile.companyId}`} className={`${bodyLink} inline-flex items-center gap-1.5 self-start text-sm`}>Conoce a {profile.name}</Link>
              </section>
            )}

            {prototype !== undefined && (
              <section data-detail-card="share" className={`${cardSurface} bg-card/40 p-5`}>
                <h3 className="text-sm font-semibold text-foreground">Compartir vacante</h3>
                <div className="mt-3 flex items-center gap-2">
                  {SHARE_ACTIONS.map(({ key, label, Icon }) => (
                    <button key={key} type="button" disabled aria-disabled="true" aria-label={`${label} (solo demostración)`} title={`${label} (solo demostración)`} className={shareButton}>
                      <Icon aria-hidden="true" className="size-[18px]" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>
        )}
      </div>
    </article>
  );
}
