"use client";

import * as React from "react";
import {
  IconBriefcase,
  IconBuildingSkyscraper,
  IconClock,
  IconDownload,
  IconEye,
  IconFileTypePdf,
  IconLanguage,
  IconMail,
  IconMapPin,
  IconPhone,
  IconSchool,
} from "@tabler/icons-react";
import { cn } from "cn";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  TALENT_AVAILABILITY_LABELS,
  TALENT_LANGUAGE_LEVEL_LABELS,
  TALENT_MODALITY_LABELS,
  TALENT_SOURCE_LABELS,
  TALENT_STAGE_LABELS,
  formatTalentDate,
  formatTalentYears,
  talentFullNameInitials,
  type TalentApplication,
  type TalentAvailability,
  type TalentLanguage,
  type TalentModality,
  type TalentStage,
} from "./model";

/**
 * Read-only detail sheet of one person.
 *
 * It is mounted once, outside the table row loop, and driven by the selected
 * person. The whole surface is a snapshot: it never contacts, downloads,
 * exports, mutates or persists anything. Status only appears on each
 * application record, never as a universal person status.
 *
 * The person it renders is a read-only view, not necessarily a complete talent
 * record: the vacancy pipeline projects only the facts its own candidate model
 * proves, so every field the caller does not supply reads as explicitly
 * unavailable instead of being invented or borrowed from a similarly named
 * person.
 *
 * The cover, identity and details share one scrolling body beneath a fixed
 * close control and above a fixed footer. The floating geometry, inset, radius and the
 * native close semantics belong to the shared `Sheet` primitive and are not
 * touched here.
 */

/** Semantic stage tone; the Spanish label always carries the meaning. */
const STAGE_VARIANT: Readonly<Record<TalentStage, BadgeVariant>> = {
  submitted: "info",
  in_review: "review",
  hired: "success",
  rejected: "danger",
};

/**
 * Preference tones. Modality and availability are profile attributes, not
 * lifecycle states, so they reuse the shared semantic variants **without** the
 * decorative lifecycle dot and the Spanish label always carries the meaning.
 */
export const TALENT_AVAILABILITY_VARIANT: Readonly<
  Record<TalentAvailability, BadgeVariant>
> = {
  immediate: "success",
  two_weeks: "info",
  one_month: "review",
  to_confirm: "neutral",
};

export const TALENT_MODALITY_VARIANT: Readonly<
  Record<TalentModality, BadgeVariant>
> = {
  remote: "info",
  hybrid: "accent",
  onsite: "neutral",
};

/**
 * Id of the visible demo disclaimer that explains the inert Currículum
 * placeholders, so both buttons can reference it through `aria-describedby`.
 */
const CV_DEMO_NOTE_ID = "talento-detalle-curriculum-demo";

/**
 * Demo-only PDF filename derived from the candidate alone. No real file exists:
 * the name is the only file metadata shown, so no size or upload date is
 * invented. Whitespace runs become single dashes to read like a real document
 * name while staying a pure function of the person.
 */
function talentCvDemoFileName(fullName: string): string {
  return `CV-${fullName.trim().replace(/\s+/gu, "-")}.pdf`;
}

export type TalentDetailSheetProps = {
  /**
   * Selected person, or `null` when the sheet is closed/empty. A complete
   * `TalentPerson` from the talent base satisfies this view as-is; a reduced
   * caller, such as the vacancy pipeline, supplies only the fields it can prove.
   */
  person: TalentDetailView | null;
  vacancyTitleById: Readonly<Record<string, string>>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional read-only extra section of locally recorded activity. The pipeline
   * passes its confirmed stage changes and prepared messages here; the talent
   * base passes nothing and the section is not rendered.
   */
  activity?: React.ReactNode;
};

/**
 * One read-only person view. Every field beyond the identity and the skills is
 * optional, because a caller may know the person without knowing their contact
 * data, formation, preferences or history. A missing field renders as
 * unavailable; it is never filled in from another record.
 */
export type TalentDetailView = {
  readonly fullName: string;
  readonly professionalTitle: string;
  readonly industry?: string;
  readonly currentCompany?: string;
  readonly skills: readonly string[];
  readonly preferredModality?: TalentModality;
  readonly availability?: TalentAvailability;
  readonly email?: string;
  readonly phone?: string;
  readonly location?: string;
  readonly education?: string;
  readonly languages?: readonly TalentLanguage[];
  readonly yearsOfExperience: number;
  readonly applications?: readonly TalentApplication[];
};

/** Honest copy of every field the current view does not carry. */
const UNAVAILABLE = "No disponible";

/**
 * Applications of one read-only view, most recent first. The shared helper is
 * typed to the complete talent person, so the reduced view sorts its own
 * records with the same order instead of fabricating a person around them.
 */
function applicationsByMostRecentView(
  applications: readonly TalentApplication[],
): readonly TalentApplication[] {
  return [...applications].sort((left, right) =>
    right.appliedAt.localeCompare(left.appliedAt),
  );
}

/**
 * One section of the detail: a real `h3` names the group and a small metadata
 * `action` slot (the application count) rides next to the heading.
 */
function DetailSection({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h3 id={id} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One muted data tile: a small functional icon plus the field label on the
 * first line and the value on the second. The `dt`/`dd` pair keeps the real
 * description-list semantics inside a `div` group, which `dl` allows.
 */
function InfoTile({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-xl bg-muted p-3",
        className,
      )}
    >
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="min-w-0 text-sm font-medium break-words text-foreground [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

export function TalentDetailSheet({
  person,
  vacancyTitleById,
  open,
  onOpenChange,
  activity,
}: TalentDetailSheetProps) {
  const applications = person?.applications ?? [];
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {person ? (
        <SheetContent
          side="right"
          initialFocus={headingRef}
          data-pf-talento-sheet=""
          className="w-full sm:max-w-2xl"
        >
          {/* One scroll container owns the cover, the identity and every
              section, so on a short viewport the tall cover and identity
              scroll away instead of crowding the fixed footer. Only the
              footer stays fixed; the native close button floats above the
              panel. */}
          <div
            data-pf-talento-sheet-body=""
            className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6"
          >
            <SheetHeader className="gap-0 -mx-6 p-0">
              {/* Full-panel-width primary cover with a subtle on-primary dot
                  texture; the shared panel `overflow-hidden` clips it to the
                  panel radius. */}
              <div
                data-pf-talento-sheet-cover=""
                className="relative h-28 w-full shrink-0 bg-primary"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[image:radial-gradient(currentColor_1px,transparent_1.5px)] text-primary-foreground opacity-[0.14] [background-size:12px_12px]"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1 px-6">
                <Avatar
                  aria-hidden="true"
                  className="-mt-7 size-14 rounded-2xl ring-4 ring-popover after:rounded-2xl"
                >
                  <AvatarFallback className="rounded-2xl bg-primary font-heading text-lg font-semibold text-primary-foreground">
                    {talentFullNameInitials(person.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <SheetTitle
                    ref={headingRef}
                    tabIndex={-1}
                    data-pf-talento-sheet-name=""
                    className="min-w-0 break-words text-xl font-semibold [overflow-wrap:anywhere]"
                  >
                    {person.fullName}
                  </SheetTitle>
                  {person.industry ? <Badge variant="accent">{person.industry}</Badge> : null}
                </div>
                <SheetDescription className="break-words [overflow-wrap:anywhere]">
                  {person.professionalTitle}
                  {person.currentCompany ? ` · ${person.currentCompany}` : ""}
                </SheetDescription>
              </div>
            </SheetHeader>

            <DetailSection id="talento-detalle-habilidades" title="Habilidades">
              <div className="flex flex-wrap gap-1.5">
                {person.skills.map((skill) => (
                  <Badge
                    key={skill}
                    variant="outline"
                    className="text-muted-foreground"
                  >
                    {skill}
                  </Badge>
                ))}
              </div>
            </DetailSection>

            {person.preferredModality === undefined && person.availability === undefined ? null : (
              <DetailSection
                id="talento-detalle-preferencias"
                title="Preferencias laborales"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {person.preferredModality === undefined ? (
                    <Badge variant="neutral">Modalidad no disponible</Badge>
                  ) : (
                    <Badge variant={TALENT_MODALITY_VARIANT[person.preferredModality]}>
                      {TALENT_MODALITY_LABELS[person.preferredModality]}
                    </Badge>
                  )}
                  {person.availability === undefined ? (
                    <Badge variant="neutral">Disponibilidad no disponible</Badge>
                  ) : (
                    <Badge variant={TALENT_AVAILABILITY_VARIANT[person.availability]}>
                      <IconClock aria-hidden="true" />
                      {TALENT_AVAILABILITY_LABELS[person.availability]}
                    </Badge>
                  )}
                </div>
              </DetailSection>
            )}

            <DetailSection
              id="talento-detalle-contacto"
              title="Datos de contacto"
            >
              <dl className="grid gap-2 sm:grid-cols-2">
                <InfoTile
                  className="sm:col-span-2"
                  icon={<IconMail className="size-3.5" />}
                  label="Correo"
                  value={person.email ?? UNAVAILABLE}
                />
                <InfoTile
                  icon={<IconPhone className="size-3.5" />}
                  label="Teléfono"
                  value={person.phone ?? UNAVAILABLE}
                />
                <InfoTile
                  icon={<IconMapPin className="size-3.5" />}
                  label="Ubicación"
                  value={person.location ?? UNAVAILABLE}
                />
              </dl>
            </DetailSection>

            <DetailSection
              id="talento-detalle-perfil"
              title="Perfil profesional"
            >
              <dl className="grid gap-2 sm:grid-cols-2">
                <InfoTile
                  icon={<IconBuildingSkyscraper className="size-3.5" />}
                  label="Industria"
                  value={person.industry ?? UNAVAILABLE}
                />
                <InfoTile
                  icon={<IconBriefcase className="size-3.5" />}
                  label="Experiencia"
                  value={formatTalentYears(person.yearsOfExperience)}
                />
                <InfoTile
                  className="sm:col-span-2"
                  icon={<IconSchool className="size-3.5" />}
                  label="Formación"
                  value={person.education ?? UNAVAILABLE}
                />
                <InfoTile
                  className="sm:col-span-2"
                  icon={<IconLanguage className="size-3.5" />}
                  label="Idiomas"
                  value={
                    person.languages === undefined
                      ? UNAVAILABLE
                      : person.languages
                          .map(
                            (language) =>
                              `${language.name} (${TALENT_LANGUAGE_LEVEL_LABELS[language.level]})`,
                          )
                          .join(" · ")
                  }
                />
              </dl>
            </DetailSection>

            {/* Demo-only Currículum surface. There is no real file, no link,
                no `href` and no download. The two affordances are standard
                `Button`s kept **enabled and inert** — visible, focusable and
                clickable with no handler, navigation, request, storage write,
                toast or success message — exactly as the durable rules require
                for presentation placeholders, explained by the visible note.

                The card composes from its own local width, never from a viewport
                breakpoint: the floating Sheet panel is capped at 24rem even on a
                wide desktop viewport, so a `sm:` row would squeeze the filename
                into a few-letters vertical column next to the intrinsic-width
                buttons. It is instead one compact column — a text row with the
                decorative medallion plus the flexible, truncating filename and
                its note, then a separate equal-column action row that wraps
                safely on the narrowest panel. */}
            <DetailSection id="talento-detalle-curriculum" title="Currículum">
              <div
                data-pf-talento-curriculum=""
                className="flex flex-col gap-3 rounded-xl bg-muted p-3"
              >
                <div
                  data-pf-talento-curriculum-text=""
                  className="flex min-w-0 items-center gap-3"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                  >
                    <IconFileTypePdf className="size-6" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p
                      data-pf-talento-curriculum-filename=""
                      title={talentCvDemoFileName(person.fullName)}
                      className="min-w-0 truncate text-sm font-medium text-foreground"
                    >
                      {talentCvDemoFileName(person.fullName)}
                    </p>
                    <p
                      id={CV_DEMO_NOTE_ID}
                      className="min-w-0 text-xs break-words text-muted-foreground [overflow-wrap:anywhere]"
                    >
                      Archivo de ejemplo · Solo demostración
                    </p>
                  </div>
                </div>
                <div
                  data-pf-talento-curriculum-actions=""
                  className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2"
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full min-w-0"
                    aria-describedby={CV_DEMO_NOTE_ID}
                  >
                    <IconEye aria-hidden="true" />
                    Ver CV
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full min-w-0"
                    aria-describedby={CV_DEMO_NOTE_ID}
                  >
                    <IconDownload aria-hidden="true" />
                    Descargar
                  </Button>
                </div>
              </div>
            </DetailSection>

            {applications.length === 0 ? null : (
              <DetailSection
                id="talento-detalle-postulaciones"
                title="Historial de postulaciones"
                action={person === null ? null : <Badge variant="secondary">{applications.length}</Badge>}
              >
                <ul data-pf-talento-history="" className="flex flex-col gap-3">
                  {applicationsByMostRecentView(applications).map((application) => {
                    const vacancyTitle =
                      vacancyTitleById[application.vacancyId] ??
                      application.vacancyId;
                    return (
                      <li
                        key={application.id}
                        data-pf-talento-history-item={application.id}
                        data-pf-talento-history-vacancy={application.vacancyId}
                        className="flex items-start gap-3"
                      >
                        <Avatar
                          aria-hidden="true"
                          className="size-9 shrink-0 rounded-lg after:rounded-lg"
                        >
                          <AvatarFallback className="rounded-lg bg-muted text-xs font-medium text-muted-foreground">
                            {talentFullNameInitials(vacancyTitle)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                            <span className="min-w-0 text-sm font-medium break-words text-foreground [overflow-wrap:anywhere]">
                              {vacancyTitle}
                            </span>
                            <Badge variant={STAGE_VARIANT[application.stage]} dot>
                              {TALENT_STAGE_LABELS[application.stage]}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {TALENT_SOURCE_LABELS[application.source]} ·{" "}
                            {formatTalentDate(application.appliedAt)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </DetailSection>
            )}

            {activity ? (
              <DetailSection id="talento-detalle-actividad" title="Actividad reciente">
                {activity}
              </DetailSection>
            ) : null}
          </div>

          <SheetFooter className="border-t border-border">
            <SheetClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  data-pf-talento-sheet-close=""
                />
              }
            >
              Cerrar
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
