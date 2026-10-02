"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";

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
import { Input } from "@/components/ui/input";
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
  APPLICATION_CANDIDATE_FIELDS,
  APPLICATION_CANDIDATE_FIELD_IDS,
  APPLICATION_CANDIDATE_FIELD_LABELS,
  applicationCandidateDraftFromFixture,
  parseApplicationCandidateDraft,
  type ApplicationCandidateDraft,
  type ApplicationCandidateDraftIssue,
  type ApplicationCandidateField,
} from "./application-candidate-draft";
import { ApplicationCandidateCard } from "./application-candidate-card";
import {
  applicationCvFormatLabel,
  formatApplicationCvSize,
  parseApplicationCvSelection,
} from "./application-cv";
import { ApplicationCvStep } from "./application-cv-step";
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
 * Interactive four-step application wizard for the public `postular` route.
 * It owns only local React state: the identity and profile it receives seed the
 * editable contact draft, a local parser normalizes both the candidate data and
 * the cover letter on Continue, an optional `File | null` holds the CV that is
 * never read, stored or sent, and the right rail keeps a live candidate card
 * beside the server-rendered vacancy summary the caller slots in. Nothing is
 * ever sent, stored, or faked: the single transport-free escape hatch is the
 * login link, because sending requires an authenticated candidate.
 */
type VacancyApplicationWizardProps = {
  job: PrototypeJobView;
  identity: CandidateIdentity;
  profile: CandidateProfile;
  avatarSrc: string;
  /** Server-rendered static vacancy summary, slotted into the desktop rail. */
  vacancySummary: React.ReactNode;
};

const STEP_LABELS = ["Tus datos", "Tu postulación", "Tu CV", "Revisar"] as const;
const STEP_COUNT = STEP_LABELS.length;
/**
 * Shared attributes that turn each step title into the accessible focus target
 * a real step transition moves focus to. `tabIndex={-1}` makes it
 * programmatically focusable without adding it to the tab order, and the
 * heading role keeps it announced as the step it names.
 */
const STEP_TITLE_ATTRS = {
  tabIndex: -1,
  role: "heading",
  "aria-level": 2,
  "data-pf-application-step-title": true,
  className: "outline-none",
} as const;
const DEFAULT_SOURCE: ApplicationDraftSource = "job_board";
const EMPTY_LETTER_LABEL = "Sin carta de presentación";
const EMPTY_CV_LABEL = "Sin CV seleccionado";
const UNSPECIFIED = "Sin especificar";
const COVER_LETTER_ERROR = `La carta de presentación no puede superar los ${MAX_APPLICATION_COVER_LETTER_CODE_POINTS} caracteres.`;
/** Stable ids shared by the cover-letter control, its counter and its error. */
const COVER_LETTER_ID = "application-cover-letter";
const COVER_LETTER_HELP_ID = "application-cover-letter-help";
const COVER_LETTER_ERROR_ID = "application-cover-letter-error";

/** One content column with the rail beside it from `lg` up, never below. */
const APPLICATION_GRID = "grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]";

/**
 * Desktop-only application rail: sticky inside its grid area at `lg` and up,
 * plain flow below it. No base `sticky`, so the narrow layout keeps normal
 * scrolling and the live candidate card stays in the reading order.
 */
const APPLICATION_RAIL = "flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start";

/** Ordered closed-vocabulary Select items, straight from the shared contract. */
const SOURCE_ITEMS = APPLICATION_DRAFT_SOURCES.map((value) => ({
  value,
  label: APPLICATION_DRAFT_SOURCE_LABELS[value],
}));

/** Browser autofill hint per editable candidate field. */
const CANDIDATE_AUTOCOMPLETE: Readonly<Record<ApplicationCandidateField, string>> = {
  fullName: "name",
  email: "email",
  phone: "tel",
  professionalTitle: "organization-title",
  city: "address-level2",
  country: "country-name",
};

/** One editable row: the field schema owns the type, the label and the hint come from the draft contract. */
type CandidateFieldSpec = {
  readonly path: ApplicationCandidateField;
  readonly id: string;
  readonly label: string;
  readonly type: "text" | "email" | "tel";
  readonly autoComplete: string;
};

const CANDIDATE_FIELD_SPECS: readonly CandidateFieldSpec[] = APPLICATION_CANDIDATE_FIELDS.map((path) => ({
  path,
  id: APPLICATION_CANDIDATE_FIELD_IDS[path],
  label: APPLICATION_CANDIDATE_FIELD_LABELS[path],
  type: path === "email" ? "email" : path === "phone" ? "tel" : "text",
  autoComplete: CANDIDATE_AUTOCOMPLETE[path],
}));

/** One Spanish message per invalid field, keyed by its stable field path. */
type CandidateFieldErrors = Partial<Record<ApplicationCandidateField, string>>;

/** Narrows the parser's free-form issue path back to a known local field. */
function knownField(path: string): ApplicationCandidateField | undefined {
  return APPLICATION_CANDIDATE_FIELDS.find((field) => field === path);
}

/** Maps every parser issue onto the field it blames, keeping the first message. */
function fieldErrorsOf(issues: readonly ApplicationCandidateDraftIssue[]): CandidateFieldErrors {
  const errors: CandidateFieldErrors = {};
  for (const issue of issues) {
    const field = knownField(issue.path);
    if (field !== undefined && errors[field] === undefined) errors[field] = issue.message;
  }
  return errors;
}

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

/** A blank local value reads as "not declared"; never as an invented one. */
function declaredOrPlaceholder(value: string): string {
  const trimmed = value.trim();
  return trimmed === "" ? UNSPECIFIED : trimmed;
}

export function VacancyApplicationWizard({
  job,
  identity,
  profile,
  avatarSrc,
  vacancySummary,
}: VacancyApplicationWizardProps) {
  const [step, setStep] = React.useState(0);
  const [candidateDraft, setCandidateDraft] = React.useState<ApplicationCandidateDraft>(() =>
    applicationCandidateDraftFromFixture(identity, profile),
  );
  const [candidateErrors, setCandidateErrors] = React.useState<CandidateFieldErrors>({});
  const [candidateSnapshot, setCandidateSnapshot] = React.useState<ApplicationCandidateDraft | null>(
    null,
  );
  const [source, setSource] =
    React.useState<ApplicationDraftSource>(DEFAULT_SOURCE);
  const [coverLetter, setCoverLetter] = React.useState("");
  const [coverLetterError, setCoverLetterError] = React.useState<string | null>(
    null,
  );
  const [reviewDraft, setReviewDraft] = React.useState<ApplicationDraft | null>(
    null,
  );
  // The optional CV stays a raw `File | null` beside the strict drafts: it is
  // never normalized, serialized or persisted, only held for this page.
  const [cvFile, setCvFile] = React.useState<File | null>(null);
  const [cvError, setCvError] = React.useState<string | null>(null);

  const candidateFieldRefs = React.useRef<
    Partial<Record<ApplicationCandidateField, HTMLInputElement | null>>
  >({});
  const coverLetterRef = React.useRef<HTMLTextAreaElement | null>(null);
  const stepTitleRef = React.useRef<HTMLDivElement | null>(null);
  const focusStepOnMount = React.useRef(false);

  // A real transition unmounts the control the visitor just activated, so focus
  // would otherwise fall back to the document body. Move it deliberately into
  // the incoming step title. The flag keeps the initial mount and every
  // validation failure (which focuses the offending field instead) untouched.
  React.useEffect(() => {
    if (!focusStepOnMount.current) return;
    focusStepOnMount.current = false;
    stepTitleRef.current?.focus();
  }, [step]);

  /** Every real step change goes through here, so focus always follows it. */
  function goToStep(next: number): void {
    focusStepOnMount.current = true;
    setStep(next);
  }

  const codePoints = countApplicationCoverLetterCodePoints(coverLetter);
  const reviewedSource = reviewDraft?.source ?? source;
  const reviewedLetter = reviewDraft?.coverLetter ?? null;
  // The review reads the last normalized snapshot; the rail card reads the raw
  // draft so it repaints while the visitor is still typing.
  const reviewedCandidate = candidateSnapshot ?? candidateDraft;

  /** Keeps the raw edit and clears the stale message of the field being fixed. */
  function updateCandidateField(field: ApplicationCandidateField, value: string): void {
    setCandidateDraft((current) => ({ ...current, [field]: value }));
    setCandidateErrors((current) => {
      if (current[field] === undefined) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /**
   * Normalizes the local candidate draft before leaving step 1. Invalid input
   * keeps the visitor on the step, shows the exact Spanish FieldError, and moves
   * focus to the first field that needs attention; the raw edits stay untouched
   * so Back never loses what was typed.
   */
  function continueFromCandidate(): void {
    const parsed = parseApplicationCandidateDraft(candidateDraft);
    if (!parsed.ok) {
      const errors = fieldErrorsOf(parsed.issues);
      setCandidateErrors(errors);
      const [firstIssue] = parsed.issues;
      const firstField = firstIssue === undefined ? undefined : knownField(firstIssue.path);
      if (firstField !== undefined) candidateFieldRefs.current[firstField]?.focus();
      return;
    }
    setCandidateErrors({});
    setCandidateSnapshot(parsed.draft);
    goToStep(1);
  }

  /**
   * Normalizes the untrusted application draft through the shared contract
   * before leaving step 2. Invalid input keeps the visitor on the application
   * step with the normalized FieldError; the raw letter and source stay
   * untouched so Back never loses what was typed.
   */
  function continueFromApplication(): void {
    const parsed = parseApplicationDraft({ source, coverLetter });
    if (!parsed.ok) {
      const invalidLetter = parsed.issues.some(
        (issue) => issue.path === "coverLetter",
      );
      setCoverLetterError(
        invalidLetter ? COVER_LETTER_ERROR : "Revisa los datos de tu postulación.",
      );
      // Invalid cover letter keeps the visitor on the step and moves focus to it.
      if (invalidLetter) coverLetterRef.current?.focus();
      return;
    }
    setCoverLetterError(null);
    setReviewDraft(parsed.draft);
    goToStep(2);
  }

  /**
   * Validates one raw picker/drop selection with the shared pure contract. An
   * empty selection is a cancelled picker and preserves the current file, an
   * invalid one keeps the last valid file and shows its Spanish message, and a
   * valid one replaces the selection.
   */
  function selectCvFiles(files: readonly File[]): void {
    if (files.length === 0) return;
    const parsed = parseApplicationCvSelection(files);
    if (!parsed.ok) {
      setCvError(parsed.issues[0].message);
      return;
    }
    setCvError(null);
    setCvFile(parsed.file);
  }

  /** Clears the optional CV; the step returns focus to the file input. */
  function removeCv(): void {
    setCvFile(null);
    setCvError(null);
  }

  return (
    <div data-pf-application-grid className={APPLICATION_GRID}>
      <div
        data-pf-application-form-host
        className="flex min-w-0 flex-col gap-6"
      >
        <div className="flex flex-col gap-3">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
              <CardTitle ref={stepTitleRef} {...STEP_TITLE_ATTRS}>Tus datos</CardTitle>
              <CardDescription>
                Revisa y actualiza tus datos de contacto para esta postulación.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                {CANDIDATE_FIELD_SPECS.map((spec) => {
                  const error = candidateErrors[spec.path];
                  return (
                    <Field
                      key={spec.path}
                      data-invalid={error !== undefined ? true : undefined}
                    >
                      <FieldLabel htmlFor={spec.id}>{spec.label}</FieldLabel>
                      <Input
                        id={spec.id}
                        type={spec.type}
                        autoComplete={spec.autoComplete}
                        value={candidateDraft[spec.path]}
                        aria-invalid={error !== undefined ? true : undefined}
                        aria-describedby={error !== undefined ? `${spec.id}-error` : undefined}
                        onChange={(event) => updateCandidateField(spec.path, event.target.value)}
                        ref={(node: HTMLInputElement | null) => {
                          candidateFieldRefs.current[spec.path] = node;
                        }}
                        className="min-h-11 text-foreground"
                      />
                      <FieldError id={`${spec.id}-error`}>{error}</FieldError>
                    </Field>
                  );
                })}
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="button" className="min-h-11" onClick={continueFromCandidate}>
                Continuar
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {step === 1 ? (
          <Card data-pf-application-step="application">
            <CardHeader>
              <CardTitle ref={stepTitleRef} {...STEP_TITLE_ATTRS}>Tu postulación</CardTitle>
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
                    Elige la opción que mejor describa cómo llegaste a la vacante.
                  </FieldDescription>
                </Field>
                <Field
                  data-invalid={coverLetterError !== null ? true : undefined}
                >
                  <FieldLabel htmlFor={COVER_LETTER_ID}>
                    Carta de presentación (opcional)
                  </FieldLabel>
                  {/* No HTML `maxLength`: it counts UTF-16 code units, while the
                      shared contract and counter measure Unicode code points. */}
                  <Textarea
                    id={COVER_LETTER_ID}
                    ref={coverLetterRef}
                    value={coverLetter}
                    aria-invalid={
                      coverLetterError !== null ? true : undefined
                    }
                    aria-describedby={
                      coverLetterError === null
                        ? COVER_LETTER_HELP_ID
                        : `${COVER_LETTER_HELP_ID} ${COVER_LETTER_ERROR_ID}`
                    }
                    onChange={(event) => {
                      setCoverLetter(event.target.value);
                      if (coverLetterError !== null) setCoverLetterError(null);
                    }}
                    className="min-h-32 text-foreground"
                  />
                  <FieldDescription id={COVER_LETTER_HELP_ID}>
                    {codePoints} de {MAX_APPLICATION_COVER_LETTER_CODE_POINTS}
                  </FieldDescription>
                  <FieldError id={COVER_LETTER_ERROR_ID}>
                    {coverLetterError}
                  </FieldError>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-between">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => goToStep(0)}>
                Atrás
              </Button>
              <Button type="button" className="min-h-11" onClick={continueFromApplication}>
                Continuar
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {step === 2 ? (
          <ApplicationCvStep
            file={cvFile}
            error={cvError}
            onFiles={selectCvFiles}
            onRemove={removeCv}
            onBack={() => goToStep(1)}
            onContinue={() => goToStep(3)}
            titleRef={stepTitleRef}
          />
        ) : null}

        {step === 3 ? (
          <Card data-pf-application-step="review">
            <CardHeader>
              <CardTitle ref={stepTitleRef} {...STEP_TITLE_ATTRS}>Revisar</CardTitle>
              <CardDescription>
                Revisa tu postulación antes de continuar.
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
                    Nombre completo
                  </dt>
                  <dd className="text-sm text-foreground">
                    {reviewedCandidate.fullName}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">
                    Correo electrónico
                  </dt>
                  <dd className="text-sm text-foreground">
                    {reviewedCandidate.email}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">
                    Teléfono
                  </dt>
                  <dd className="text-sm text-foreground">
                    {declaredOrPlaceholder(reviewedCandidate.phone)}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">
                    Título profesional
                  </dt>
                  <dd className="text-sm text-foreground">
                    {declaredOrPlaceholder(reviewedCandidate.professionalTitle)}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">
                    Ubicación
                  </dt>
                  <dd className="text-sm text-foreground">
                    {[reviewedCandidate.city, reviewedCandidate.country]
                      .map((part) => part.trim())
                      .filter((part) => part !== "")
                      .join(", ") || UNSPECIFIED}
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
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">
                    CV
                  </dt>
                  <dd
                    data-pf-application-review-cv
                    className="text-sm break-all text-foreground"
                  >
                    {cvFile === null
                      ? EMPTY_CV_LABEL
                      : `${cvFile.name} · ${applicationCvFormatLabel(cvFile.name)} · ${formatApplicationCvSize(cvFile.size)}`}
                  </dd>
                </div>
              </dl>
              <Separator />
              <p
                role="note"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Para enviar tu postulación necesitas iniciar sesión después de
                revisar estos datos.
              </p>
            </CardContent>
            <CardFooter className="justify-between">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => goToStep(2)}>
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

      <aside className={APPLICATION_RAIL}>
        <ApplicationCandidateCard
          draft={candidateDraft}
          skills={profile.skills}
          avatarSrc={avatarSrc}
        />
        {vacancySummary}
      </aside>
    </div>
  );
}
