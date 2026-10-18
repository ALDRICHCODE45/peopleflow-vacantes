import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  BanknoteIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarClockIcon,
  CalendarHeartIcon,
  ChevronRightIcon,
  ClockIcon,
  EllipsisIcon,
  GlobeIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  LaptopIcon,
  LayoutGridIcon,
  MapPinIcon,
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { findCompanyProfile } from "../../company-profile/model";
import { PROTOTYPE_COMPANY_PROFILES } from "../../company-profile/prototype-companies";
import { vacancyApplicationHref } from "../application/application-draft";
import type { JobLanguage, PrototypeJobView } from "../enrich";
import type { PublicJobDetail } from "../types";
import { PublicJobDetailView } from "./PublicJobDetailView";
import {
  employmentTypeLabel,
  formatClosingDate,
  formatPublishedDate,
  formatSalary,
  payFrequencyLabel,
  seniorityLabel,
  workModeLabel,
} from "../formatters";
import { PrototypeFeedbackButton } from "./prototype-feedback-island";
import { CompanyMonogram, VerifiedByPeopleFlow, prototypeApplicantsLabel, prototypeResponseLabel } from "./prototype-ui";

/** Contextual icon per wire work mode, mirroring the public board rows. */
const WORK_MODE_ICONS = {
  onsite: MapPinIcon,
  remote: GlobeIcon,
  hybrid: Building2Icon,
} as const satisfies Record<PrototypeJobView["work_mode"], typeof MapPinIcon>;

const statTile = "grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-foreground";
const statValue = "break-words font-medium text-foreground";
const metaValue = "mt-0.5 font-medium break-words text-foreground";
const focusRing =
  "rounded-md transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/* Body links keep `text-foreground` with an always-visible underline, because the accent token fails AA for body text on the dark page background. */
const bodyLink =
  "font-medium text-foreground underline decoration-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** Primary apply affordance: a token tint shared by the real application link. */
const actionPrimary = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-4 text-sm font-semibold text-foreground";
/** Secondary save affordance, styled for the toggle save island. */
const actionGhost = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-muted-foreground";
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

/** Drops blank entries so an empty authored list never renders an empty section. */
const nonBlank = (values: readonly string[]) => values.filter((value) => value.trim().length > 0);

/** Keeps only languages a candidate can read; the level stays optional. */
const spelledLanguages = (languages: readonly JobLanguage[]) =>
  languages.filter((language) => language.name.trim().length > 0);

/** Non-persistent share affordances: three placeholder controls. */
const SHARE_ACTIONS = [
  { key: "copy", label: "Copiar enlace" },
  { key: "share", label: "Compartir en redes" },
  { key: "mail", label: "Enviar por correo" },
] as const;

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
    <div className="flex flex-col gap-4">
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
 * Role block, rendered after the wire description. Every value is display
 * enrichment, so the block never fuses with the wire metadata: it carries no
 * image and no paragraph (the description paragraphs stay the article's only
 * `p` elements), and every requirement, skill, language, question, and benefit
 * renders as escaped plain text. The block is an h2 sibling of the page's other
 * sections, with its own groups as h3; the profile group holds requirements,
 * skills, and languages, the benefits group holds one tile per benefit, and the
 * before-applying group holds the deadline and the read-only prompts, so the
 * page keeps one unbroken outline. Skills and languages are chips, and each
 * benefit is a tile on a semantic token surface.
 */
function PrototypeRoleSection({ job }: { job: PrototypeJobView }) {
  const prototype = job.prototype;
  if (prototype === undefined) return null;
  const closingDate =
    prototype.closingDate === undefined
      ? null
      : formatClosingDate(prototype.closingDate);
  const requiredRequirements = nonBlank(prototype.requiredRequirements);
  const preferredRequirements = nonBlank(prototype.preferredRequirements);
  const skills = nonBlank(prototype.skills);
  const benefits = nonBlank(prototype.benefits);
  const languages = spelledLanguages(prototype.languages ?? []);
  const questions = nonBlank(prototype.applicationQuestions ?? []);
  const hasRequirements = requiredRequirements.length > 0 || preferredRequirements.length > 0;
  const hasBeforeApplying = closingDate !== null || questions.length > 0;

  return (
    <Card role="region" aria-labelledby="vacante-rol" data-detail-card="prototype">
      <CardHeader>
        <CardTitle><h2 id="vacante-rol" className="font-heading text-lg font-semibold">{prototype.department}</h2></CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
      <div data-detail-group="profile" className="flex flex-col gap-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Frecuencia de pago</dt>
            <dd className="font-medium text-foreground">
              {payFrequencyLabel(prototype.payFrequency)}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Experiencia</dt>
            <dd className="font-medium text-foreground">
              {prototype.experienceLabel}
            </dd>
          </div>
        </dl>

        {hasRequirements && (
          <div className="flex flex-col gap-3">
            <h3 className="font-heading text-base font-semibold text-foreground">
              Requisitos
            </h3>
            {requiredRequirements.length > 0 && (
              <>
                <h4 className="text-sm font-semibold text-foreground">
                  Indispensables
                </h4>
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                  {requiredRequirements.map((requirement) => (
                    <li
                      key={requirement}
                      className="border-l-2 border-primary/40 pl-3 leading-relaxed"
                    >
                      {requirement}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {preferredRequirements.length > 0 && (
              <>
                <h4 className="mt-1 text-sm font-semibold text-foreground">
                  Deseables
                </h4>
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                  {preferredRequirements.map((requirement) => (
                    <li
                      key={requirement}
                      className="border-l-2 border-primary/40 pl-3 leading-relaxed"
                    >
                      {requirement}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {skills.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="font-heading text-base font-semibold text-foreground">
              Habilidades
            </h3>
            <ul className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <li
                  key={skill}
                  className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {skill}
                </li>
              ))}
            </ul>
          </div>
        )}

        {languages.length > 0 && (
          <div data-detail-languages className="flex flex-col gap-3">
            <h3 className="font-heading text-base font-semibold text-foreground">
              Idiomas
            </h3>
            <ul className="flex flex-wrap gap-2">
              {languages.map((language) => (
                <li key={language.name}>
                  <Badge variant="outline" className="text-muted-foreground">
                    {language.level === undefined
                      ? language.name
                      : `${language.name} · ${language.level}`}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {benefits.length > 0 && (
        <div data-detail-group="benefits" className="flex flex-col gap-3">
          <h3 className="font-heading text-base font-semibold text-foreground">
            Beneficios
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {benefits.map((benefit) => {
              const Icon = benefitIcon(benefit);
              return (
                <li key={benefit} data-benefit-tile className="min-w-0">
                  <Item variant="outline" size="sm">
                    <ItemMedia variant="icon" aria-hidden="true"><Icon /></ItemMedia>
                    <ItemContent className="min-w-0 break-words text-muted-foreground">{benefit}</ItemContent>
                  </Item>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasBeforeApplying && (
        <div data-detail-group="before-applying" className="flex flex-col gap-3">
          <h3 className="font-heading text-base font-semibold text-foreground">
            Antes de postularte
          </h3>
          {closingDate !== null && (
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">
                  Cierre de postulaciones
                </dt>
                <dd className="font-medium text-foreground">{closingDate}</dd>
              </div>
            </dl>
          )}
          {questions.length > 0 && (
            <>
              <h4 className="text-sm font-semibold text-foreground">
                Preguntas al postularte
              </h4>
              <ul
                data-detail-questions
                className="flex flex-col gap-2 text-sm text-muted-foreground"
              >
                {questions.map((question) => (
                  <li
                    key={question}
                    className="border-l-2 border-primary/40 pl-3 leading-relaxed"
                  >
                    {question}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      </CardContent>
    </Card>
  );
}

/**
 * Server-rendered validated detail view in the reference composition: the
 * breadcrumb to the canonical board, the identity header (monogram, title,
 * featured state, company, and wire and display metadata),
 * four stat cards, the structured role content (requirements, skill
 * chips, and token-only benefit tiles), and the responsive content/sticky-rail
 * scaffold. Only the wire description renders as `p` elements: every other
 * text node is a span, term, or definition. The company links to its canonical
 * profile only under the same exact opt-in match as that block; the rail
 * carries the wire salary, the real apply link and the save/share placeholder
 * controls, and the profile context, and it is omitted entirely when neither
 * salary nor an exact profile resolves. This view stays a server
 * component: it forwards plain strings to the controls and owns no client
 * directive, hook, request, storage, or business mutation.
 */
export function JobDetailView({ job }: { job: PrototypeJobView | PublicJobDetail }) {
  if ("source" in job) return <PublicJobDetailView job={job} />;
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
      key: "level",
      label: "Nivel",
      Icon: TrendingUpIcon,
      value: seniorityLabel(job.seniority),
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

      <Card data-detail-region="header">
        <CardHeader>
          <CardTitle><h1 className="flex items-start gap-4 font-heading text-2xl font-bold tracking-tight md:text-3xl">
            <CompanyMonogram name={job.company.name} />
            <span className="min-w-0 break-words">{job.title}</span>
          </h1></CardTitle>
          {prototype?.featured === true && <CardAction><Badge variant="accent" data-detail-flag="featured">Destacada</Badge></CardAction>}
          <CardDescription>
              {profile === undefined ? (
                <span>{job.company.name}</span>
              ) : (
                <Link href={`/empresas/${profile.companyId}`} className={`${bodyLink} text-sm`}>{job.company.name}</Link>
              )}
          </CardDescription>
        </CardHeader>
        {meta.length > 0 && <CardFooter>
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
        </CardFooter>}
      </Card>

      <div data-detail-region="stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ key, label, Icon, value }) => (
          <Card key={key} size="sm" data-detail-stat={key} aria-labelledby={`job-stat-${key}`}>
            <CardHeader><CardTitle><h2 id={`job-stat-${key}`} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span aria-hidden="true" className={statTile}><Icon className="size-3.5" /></span>{label}
            </h2></CardTitle></CardHeader>
            <CardContent><span className={statValue}>{value}</span></CardContent>
          </Card>
        ))}
      </div>

      {/* Responsive scaffold: one content column with the rail beside it from `lg` up. The rail becomes sticky inside its grid area at desktop and stacks back into normal flow below `lg`. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div data-detail-region="content" className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader><CardTitle><h2 className="font-heading text-xl font-semibold">Sobre la vacante</h2></CardTitle></CardHeader>
            <CardContent><DescriptionParagraphs description={job.description} /></CardContent>
          </Card>
          <PrototypeRoleSection job={job} />
        </div>

        {(salary !== null || profile !== undefined) && (
          <aside data-detail-region="rail" className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
            {salary !== null && (
              <Card data-detail-card="salary">
                <CardHeader><CardTitle><h2 className="flex items-center gap-1.5">
                  <BanknoteIcon aria-hidden="true" className="size-3.5 shrink-0" />Salario
                </h2></CardTitle></CardHeader>
                <CardContent><span className="font-heading text-2xl font-bold tracking-tight">{salary}</span></CardContent>
              </Card>
            )}

            {prototype !== undefined && (
              <Card data-detail-card="actions">
                <CardHeader>
                  <CardTitle><h3>Postulación</h3></CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    <ZapIcon aria-hidden="true" className="size-4 shrink-0" />
                    {prototypeResponseLabel(prototype.responseTimeDays)}
                  </CardDescription>
                  <CardAction><PrototypeFeedbackButton icon="bookmark" label="Guardar vacante" text="Guardar" className={actionGhost} /></CardAction>
                </CardHeader>
                {prototype.verifiedByPeopleFlow && <CardContent><VerifiedByPeopleFlow /></CardContent>}
                <CardFooter><Link
                  href={vacancyApplicationHref(job.id)}
                  className={actionPrimary}
                >
                  Postularme
                  <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0" />
                </Link></CardFooter>
              </Card>
            )}

            {profile !== undefined && (
              <Card data-detail-card="company">
                <CardHeader>
                  <CardTitle><h3 className="flex items-center gap-3">
                    <CompanyMonogram name={profile.name} size="compact" />{profile.name}
                  </h3></CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-x-1.5">
                      <span>{profile.companySize}</span>
                      <span aria-hidden="true">·</span>
                      <span>{profile.location}</span>
                  </CardDescription>
                </CardHeader>
                <CardFooter><Link href={`/empresas/${profile.companyId}`} className={`${bodyLink} inline-flex items-center gap-1.5 self-start text-sm`}>Conoce a {profile.name}</Link></CardFooter>
              </Card>
            )}

            {prototype !== undefined && (
              <Card data-detail-card="share">
                <CardHeader>
                  <CardTitle><h3>Compartir vacante</h3></CardTitle>
                  <CardAction>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label="Acciones de compartir vacante"><EllipsisIcon /></Button>} />
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          {SHARE_ACTIONS.map(({ key, label }) => <DropdownMenuItem key={key} className="min-h-10">{label}</DropdownMenuItem>)}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardAction>
                </CardHeader>
              </Card>
            )}
          </aside>
        )}
      </div>
    </article>
  );
}
