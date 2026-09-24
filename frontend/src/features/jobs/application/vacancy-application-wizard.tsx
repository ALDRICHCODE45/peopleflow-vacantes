"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

import type { CandidateIdentity, CandidateProfile } from "@/features/candidate/model";
import type { PrototypeJobView } from "../enrich";
import {
  APPLICATION_DRAFT_SOURCES,
  APPLICATION_DRAFT_SOURCE_LABELS,
  MAX_APPLICATION_COVER_LETTER_CODE_POINTS,
  countApplicationCoverLetterCodePoints,
  parseApplicationDraft,
  type ApplicationDraft,
  type ApplicationDraftSource,
} from "./application-draft";

/**
 * Interactive three-step application wizard for the public `postular` route.
 * It owns only local React state: the frozen demo profile is read-only, the
 * draft is normalized by the shared contract on Continue, and the review step
 * never sends, stores, or fakes a submission. The single transport-free escape
 * hatch is the login link, because sending requires an authenticated candidate.
 */
type VacancyApplicationWizardProps = {
  job: PrototypeJobView;
  identity: CandidateIdentity;
  profile: CandidateProfile;
  avatarSrc: string;
};

const STEP_COUNT = 3;
const STEP_LABELS = ["Tus datos", "Tu postulación", "Revisar"] as const;
const DEFAULT_SOURCE: ApplicationDraftSource = "job_board";
const EMPTY_LETTER_LABEL = "Sin carta de presentación";
const COVER_LETTER_ERROR = `La carta de presentación no puede superar los ${MAX_APPLICATION_COVER_LETTER_CODE_POINTS} caracteres.`;

/** Ordered closed-vocabulary Select items, straight from the shared contract. */
const SOURCE_ITEMS = APPLICATION_DRAFT_SOURCES.map((value) => ({
  value,
  label: APPLICATION_DRAFT_SOURCE_LABELS[value],
}));

/** Token-only paint for one rail marker: one baseline, semantic colors only. */
const RAIL_BASE =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums";
const RAIL_STATE = {
  complete: "border-primary text-foreground",
  current: "border-primary bg-primary text-primary-foreground",
  upcoming: "border-border text-muted-foreground",
} as const;

type StepState = keyof typeof RAIL_STATE;

function stepStateOf(index: number, step: number): StepState {
  if (index < step) return "complete";
  if (index === step) return "current";
  return "upcoming";
}

export function VacancyApplicationWizard({
  job,
  identity,
  profile,
  avatarSrc,
}: VacancyApplicationWizardProps) {
  const [step, setStep] = React.useState(0);
  const [source, setSource] =
    React.useState<ApplicationDraftSource>(DEFAULT_SOURCE);
  const [coverLetter, setCoverLetter] = React.useState("");
  const [coverLetterError, setCoverLetterError] = React.useState<string | null>(
    null,
  );
  const [reviewDraft, setReviewDraft] = React.useState<ApplicationDraft | null>(
    null,
  );

  const codePoints = countApplicationCoverLetterCodePoints(coverLetter);
  const reviewedSource = reviewDraft?.source ?? source;
  const reviewedLetter = reviewDraft?.coverLetter ?? null;

  /**
   * Normalizes the untrusted draft through the shared contract before leaving
   * step 2. Invalid input keeps the visitor on the application step with the
   * normalized FieldError; the raw letter and source stay untouched so Back
   * never loses what was typed.
   */
  function continueFromApplication(): void {
    const parsed = parseApplicationDraft({ source, coverLetter });
    if (!parsed.ok) {
      const invalidLetter = parsed.issues.some(
        (issue) => issue.path === "coverLetter",
      );
      setCoverLetterError(
        invalidLetter ? COVER_LETTER_ERROR : "Revisá los datos de tu postulación.",
      );
      return;
    }
    setCoverLetterError(null);
    setReviewDraft(parsed.draft);
    setStep(2);
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        <ol className="grid grid-cols-3 gap-2">
          {STEP_LABELS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className="flex min-w-0 items-center gap-2"
            >
              <span
                aria-hidden="true"
                className={cn(RAIL_BASE, RAIL_STATE[stepStateOf(index, step)])}
              >
                {index + 1}
              </span>
              <span className="min-w-0 text-[11px] font-medium leading-tight text-foreground sm:text-xs">
                {label}
              </span>
            </li>
          ))}
        </ol>
        <Progress
          value={step + 1}
          max={STEP_COUNT}
          aria-valuetext={`Paso ${step + 1} de ${STEP_COUNT}`}
        >
          <ProgressLabel className="text-xs text-muted-foreground">
            Paso {step + 1} de {STEP_COUNT}
          </ProgressLabel>
        </Progress>
      </div>

      {step === 0 ? (
        <Card data-pf-application-step="profile">
          <CardHeader>
            <CardTitle>Tus datos</CardTitle>
            <CardDescription>
              Revisá tus datos antes de continuar. Se muestran solo para lectura.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              {/* Base UI's AvatarImage only mounts once a real image load
                  resolves, which jsdom never does; the frame stays local and
                  the portrait is a plain, local `<img>` with a truthful alt. */}
              <Avatar size="lg" className="size-14">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarSrc}
                  alt={`Retrato de ${identity.fullName}`}
                  className="aspect-square size-full rounded-full object-cover"
                />
              </Avatar>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Solo lectura</Badge>
                </div>
                <p className="font-heading text-base font-semibold text-foreground">
                  {identity.fullName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {profile.professionalTitle}
                </p>
              </div>
            </div>
            <Separator />
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel>Correo electrónico</FieldLabel>
                <p className="text-sm text-foreground">{identity.email}</p>
              </Field>
              <Field>
                <FieldLabel>Teléfono</FieldLabel>
                <p className="text-sm text-foreground">{profile.phone}</p>
              </Field>
              <Field>
                <FieldLabel>Ubicación</FieldLabel>
                <p className="text-sm text-foreground">
                  {profile.city}, {profile.country}
                </p>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="button" className="min-h-11" onClick={() => setStep(1)}>
              Continuar
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card data-pf-application-step="application">
          <CardHeader>
            <CardTitle>Tu postulación</CardTitle>
            <CardDescription>
              Contale al equipo de {job.company.name} por qué te interesa esta
              vacante.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-6">
              <Field>
                <FieldLabel htmlFor="application-source">
                  ¿Cómo te enteraste de la vacante?
                </FieldLabel>
                {/* The closed source vocabulary stays a controlled Select: the
                    root owns `items`/`value` and the trigger owns the combobox
                    role, while the installed popup renders the options. */}
                <Select
                  items={SOURCE_ITEMS}
                  value={source}
                  onValueChange={(next) => {
                    if (next !== null) setSource(next);
                  }}
                >
                  <SelectTrigger id="application-source" className="min-h-11 w-full text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {SOURCE_ITEMS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Elegí la opción que mejor describa cómo llegaste a la vacante.
                </FieldDescription>
              </Field>
              <Field
                data-invalid={coverLetterError !== null ? true : undefined}
              >
                <FieldLabel htmlFor="application-cover-letter">
                  Carta de presentación (opcional)
                </FieldLabel>
                {/* No HTML `maxLength`: it counts UTF-16 code units, while the
                    shared contract and counter measure Unicode code points. */}
                <Textarea
                  id="application-cover-letter"
                  value={coverLetter}
                  aria-invalid={
                    coverLetterError !== null ? true : undefined
                  }
                  aria-describedby="application-cover-letter-help"
                  onChange={(event) => {
                    setCoverLetter(event.target.value);
                    if (coverLetterError !== null) setCoverLetterError(null);
                  }}
                  className="min-h-32 text-foreground"
                />
                <FieldDescription id="application-cover-letter-help">
                  {codePoints} de {MAX_APPLICATION_COVER_LETTER_CODE_POINTS}
                </FieldDescription>
                <FieldError id="application-cover-letter-error">
                  {coverLetterError}
                </FieldError>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setStep(0)}>
              Atrás
            </Button>
            <Button type="button" className="min-h-11" onClick={continueFromApplication}>
              Continuar
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card data-pf-application-step="review">
          <CardHeader>
            <CardTitle>Revisar</CardTitle>
            <CardDescription>
              Revisá tu postulación antes de continuar.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <dl className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">
                  Vacante
                </dt>
                <dd className="text-sm text-foreground">
                  {job.title} · {job.company.name}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">
                  Postulante
                </dt>
                <dd className="text-sm text-foreground">
                  {identity.fullName} · {identity.email}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">
                  ¿Cómo te enteraste?
                </dt>
                <dd className="text-sm text-foreground">
                  {APPLICATION_DRAFT_SOURCE_LABELS[reviewedSource]}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">
                  Carta de presentación
                </dt>
                <dd className="text-sm whitespace-pre-line text-foreground">
                  {reviewedLetter ?? EMPTY_LETTER_LABEL}
                </dd>
              </div>
            </dl>
            <Separator />
            <p
              role="note"
              className="text-xs leading-relaxed text-muted-foreground"
            >
              Para enviar tu postulación necesitás iniciar sesión después de
              revisar estos datos.
            </p>
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setStep(1)}>
              Atrás
            </Button>
            <Link
              href="/candidato/login"
              className={buttonVariants({ size: "lg", className: "min-h-11" })}
            >
              Iniciar sesión para enviar
            </Link>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
