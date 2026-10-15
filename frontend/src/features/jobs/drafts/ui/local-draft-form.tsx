"use client";

import * as React from "react";
import {
  CheckCircle2Icon,
  InfoIcon,
} from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDraftSave } from "./draft-save-state";
import { DRAFT_SAVE_NOTICE, DraftSaveFeedback } from "./draft-save-feedback";
import { ActionStatusSlot } from "@/components/feedback/action-status";
import { Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
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
import { createDraftModel, type DraftModel } from "../model";
import { DraftBenefitsField } from "./draft-benefits-field";
import { DraftCompensationField } from "./draft-compensation-field";
import { DraftDescriptionEditor } from "./draft-description-editor";
import {
  changeRequesterKind,
  selectRequester,
  initialDraftFormState,
  updateCompensation,
  validateDraftFormState,
  type DraftFormErrors,
  type DraftFormState,
} from "./draft-form-state";
import { DraftLanguageField } from "./draft-language-field";
import { DraftListField } from "./draft-list-field";
import {
  CONTRACT_TYPE_OPTIONS,
  PROFESSIONAL_AREA_OPTIONS,
  SENIORITY_OPTIONS,
  WORK_MODE_OPTIONS,
  WORK_SCHEDULE_OPTIONS,
  type DraftOption,
} from "./draft-labels";
import { LOCAL_ONLY_NOTICE, QUESTIONNAIRE_DIALOG_DESCRIPTION, QUESTIONNAIRE_DIALOG_OPEN, QUESTIONNAIRE_DIALOG_TITLE, SCREENING_V2_PREVIEW_INVALID, VALIDATION_SUCCESS } from "./draft-messages";
import { DraftPreview } from "./draft-preview";
import { DraftQuestionnairePreview } from "./draft-questionnaire-preview";
import { DraftRequesterField } from "./draft-requester-field";
import { DraftScreeningV2Field } from "./draft-screening-v2-field";
import {
  projectCandidateScreeningV2,
  toDraftScreeningV2State,
  validateLocalDraftV2FormState,
  type CandidateScreeningProjection,
  type DraftScreeningV2State,
  type LocalDraftV2Snapshot,
} from "./draft-screening-v2-state";
import type { ScreeningQuestionV2 } from "../screening-v2/model";

/**
 * Complete local private-draft editor over the accepted 17-field model, shown
 * as five progressive steps: basics, description, compensation, questions and
 * the final review.
 *
 * The page owns the centered wide measure; this surface keeps every raw value in
 * one state object and exposes only the active step. Each step renders one
 * primary card whose internal groups are semantic sections and dividers, never
 * nested cards, matching the approved application-wizard composition without
 * reusing any application business logic. The final boundary validates the
 * complete snapshot. V2 then explicitly saves through a credential-free Server
 * Action; legacy v1 stays local. Incomplete drafts are valid by schema, so
 * Atrás/Continuar navigation remains unconditional. No autosave is performed.
 */
export type LocalDraftFormProps = {
  /**
   * Optional complete model whose populated fields must survive a no-op
   * validation. It selects the legacy v1 screening path unless an explicit v2
   * seed is also supplied. Defaults to a real empty `createDraftModel()`
   * factory, and a missing model means a fresh local v2 wizard.
   */
  initialModel?: DraftModel;
  /**
   * Explicit local v2 authoring seed. Supplying it selects the v2 screening
   * editor and its IDs are preserved verbatim: nothing is migrated from a v1
   * `initialModel`, no ID is regenerated and no auto conversion happens.
   */
  initialScreeningQuestionsV2?: ScreeningQuestionV2[];
};

/** Approved step order and visible titles. */
const STEP_TITLES = [
  "Información básica",
  "Descripción y perfil",
  "Compensación y beneficios",
  "Preguntas",
  "Revisión final",
] as const;
const STEP_COUNT = STEP_TITLES.length;
const LAST_STEP = STEP_COUNT - 1;

/** Contract field keys owned by each step, used to route validation errors. */
const STEP_ERROR_PREFIXES: readonly (readonly string[])[] = [
  [
    "title",
    "location",
    "work_mode",
    "work_schedule",
    "contract_type",
    "seniority",
    "professional_area",
    "requester",
  ],
  ["required_requirements", "preferred_requirements", "skills", "languages", "description"],
  ["compensation", "benefits", "custom_benefits"],
  ["screening_questions"],
  [],
];

/**
 * Token-only numbered marker of the step rail: one baseline, semantic colors
 * only, mirroring the approved application-wizard reference.
 */
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

/** Removes one field key and every indexed child of an indexed list key. */
function clearErrors(previous: DraftFormErrors, prefixes: string[]): DraftFormErrors {
  const next: DraftFormErrors = {};
  for (const [key, message] of Object.entries(previous)) {
    const cleared = prefixes.some(
      (prefix) => key === prefix || key.startsWith(`${prefix}.`),
    );
    if (!cleared) next[key] = message;
  }
  return next;
}

/** Step that owns one error key, including indexed list children. */
function errorStep(key: string): number {
  for (let step = 0; step < STEP_ERROR_PREFIXES.length; step += 1) {
    const owned = STEP_ERROR_PREFIXES[step].some(
      (prefix) => key === prefix || key.startsWith(`${prefix}.`),
    );
    if (owned) return step;
  }
  // `model` and unknown keys belong to the final review.
  return LAST_STEP;
}

/** First step with at least one error, so the user lands on the earliest one. */
function firstErrorStep(errors: DraftFormErrors): number {
  let first = LAST_STEP;
  for (const key of Object.keys(errors)) {
    first = Math.min(first, errorStep(key));
  }
  return first;
}

/**
 * One step card header. The visible copy is just the step title; the numbered
 * prefix stays in the accessible name so assistive tech still announces the
 * step while the progress bar owns the visible "Paso N de M" copy.
 */
function DraftStepHeading({
  index,
  title,
  headingRef,
}: {
  index: number;
  title: string;
  headingRef: React.Ref<HTMLDivElement>;
}) {
  return (
    <CardHeader>
      <CardTitle
        ref={headingRef}
        id={`draft-step-heading-${index + 1}`}
        role="heading"
        aria-level={2}
        tabIndex={-1}
        className="text-lg outline-none"
      >
        <span className="sr-only">{`Paso ${index + 1} de ${STEP_COUNT}: `}</span>
        {title}
      </CardTitle>
    </CardHeader>
  );
}

/** One semantic group inside a step card: titled section, never a nested card. */
function DraftStepSection({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      <h3 id={headingId} className="font-heading text-sm font-medium text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One consistent step footer: Atrás left, primary navigation right. */
function DraftStepFooter({
  onBack,
  backDisabled,
  children,
}: {
  onBack: () => void;
  backDisabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <CardFooter className="flex-wrap justify-between gap-3">
      <Button type="button" variant="outline" disabled={backDisabled} onClick={onBack}>
        Atrás
      </Button>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </CardFooter>
  );
}

/** One labelled enum select reused by every scalar group. */
function DraftSelectField({
  id,
  label,
  value,
  options,
  placeholder,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: DraftOption[];
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  return (
    <Field data-invalid={error !== undefined}>
      <FieldTitle id={labelId}>{label}</FieldTitle>
      <Select
        value={value === "" ? null : value}
        items={options}
        onValueChange={(next) => onChange(next ?? "")}
      >
        <SelectTrigger
          id={id}
          aria-labelledby={labelId}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          className="h-10 w-full text-foreground"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
}

/** One labelled multi-line text field. */
function DraftTextAreaField({
  id,
  label,
  value,
  placeholder,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        name={id}
        rows={4}
        value={value}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
}

/**
 * Candidate-facing questionnaire simulation, shown inside an official dialog.
 *
 * It stays a **sibling of the wizard form** in the React tree: the installed
 * questionnaire primitive renders its own native `<form>`, so nesting it inside
 * the wizard form would both nest forms and let its submit bubble into the
 * draft validation. The dialog is opened only from the last-step button, wraps
 * the allowlisted candidate projection only after the v2 schema accepts the raw
 * buffer, and never claims a save. Closing the dialog intentionally resets the
 * local simulation; no answer is persisted anywhere.
 */
function DraftQuestionnaireDialog({
  open,
  onOpenChange,
  projection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projection: CandidateScreeningProjection;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-pf-questionnaire-dialog=""
        className="flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-4 overflow-hidden sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{QUESTIONNAIRE_DIALOG_TITLE}</DialogTitle>
          <DialogDescription>{QUESTIONNAIRE_DIALOG_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <div
          data-pf-questionnaire-dialog-body=""
          className="flex min-h-0 flex-1 flex-col overflow-y-auto pe-1"
        >
          {projection.ok ? (
            <DraftQuestionnairePreview questions={projection.questions} />
          ) : (
            <p
              role="status"
              data-pf-candidate-questionnaire-notice=""
              className="rounded-2xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            >
              {SCREENING_V2_PREVIEW_INVALID}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LocalDraftForm({
  initialModel,
  initialScreeningQuestionsV2,
}: LocalDraftFormProps) {
  /**
   * Explicit ambiguity guard, evaluated before any state exists. A v1 model
   * that already carries screening rows cannot be combined with an explicit v2
   * seed: the two versions stay apart and the combination is a programmer
   * error, so it is rejected instead of silently ignoring, merging or dropping
   * either list. A v1 model with an empty screening list may still reuse its
   * other 16 fields with a v2 seed.
   */
  if (
    initialModel !== undefined &&
    initialScreeningQuestionsV2 !== undefined &&
    initialModel.fields.screening_questions.length > 0
  ) {
    throw new Error("Cannot combine v1 screening questions with a v2 screening seed.");
  }

  const baseModelRef = React.useRef<DraftModel | null>(null);
  if (baseModelRef.current === null) {
    baseModelRef.current = initialModel ?? createDraftModel();
  }
  const baseModel = baseModelRef.current;

  /**
   * Explicit version boundary. A fresh wizard (no `initialModel`) is local v2
   * from the start; an `initialModel` stays v1 unless an explicit v2 seed is
   * supplied. There is no lazy switch, no auto conversion and no ID migration
   * between the two versions.
   */
  const isV2 = initialScreeningQuestionsV2 !== undefined || initialModel === undefined;

  const [state, setState] = React.useState<DraftFormState>(() =>
    initialDraftFormState(baseModel),
  );
  const [v2Questions, setV2Questions] = React.useState<DraftScreeningV2State>(() =>
    toDraftScreeningV2State(initialScreeningQuestionsV2 ?? []),
  );
  const draftSave = useDraftSave();
  const [errors, setErrors] = React.useState<DraftFormErrors>({});
  const [validated, setValidated] = React.useState<
    DraftModel | LocalDraftV2Snapshot | null
  >(null);
  const [step, setStep] = React.useState(0);
  const [focusRevision, setFocusRevision] = React.useState(0);
  // Explicit validation requests, not persisted state: each increment asks the
  // screening editor to open its first invalid question, and drives the
  // candidate simulation dialog from the last-step button.
  const [screeningOpenToken, setScreeningOpenToken] = React.useState(0);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const stepHeadingRef = React.useRef<HTMLDivElement | null>(null);
  const hasMountedRef = React.useRef(false);

  /**
   * Presentation-only candidate projection of the raw v2 buffer. `null` on the
   * legacy v1 path, which has no v2 simulation; `ok: false` keeps the "Probar
   * cuestionario" control disabled and truthful instead of faking a preview.
   */
  const candidateProjection = React.useMemo(
    () => (isV2 ? projectCandidateScreeningV2(v2Questions) : null),
    [isV2, v2Questions],
  );

  // Move focus to the step heading on every transition and after an error
  // route, so the new step (and its feedback) is announced; never on mount.
  React.useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step, focusRevision]);

  function goToStep(next: number) {
    setStep(Math.min(Math.max(next, 0), LAST_STEP));
  }

  /** One edit: update raw state, drop the previous success and its errors. */
  function applyState(
    update: (previous: DraftFormState) => DraftFormState,
    errorPrefixes: string[],
  ) {
    setState(update);
    if (isV2) draftSave.edited();
    setValidated(null);
    setErrors((previous) => clearErrors(previous, errorPrefixes));
  }

  /** One v2 edit: update the raw buffer, drop success and screening errors. */
  function applyV2Questions(
    update: (previous: DraftScreeningV2State) => DraftScreeningV2State,
  ) {
    setV2Questions(update);
    draftSave.edited();
    setValidated(null);
    setErrors((previous) => clearErrors(previous, ["screening_questions"]));
  }

  /**
   * Explicit atomic boundary on the last step. Before it, Enter only moves on:
   * the incomplete draft is never validated and no success is claimed. On the
   * last step the complete composed model goes through the accepted serializer
   * once; a rejection leaves the raw inputs editable, routes to the first
   * offending step and reports every offending field.
   */
  function handleValidate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < LAST_STEP) {
      goToStep(step + 1);
      return;
    }
    if (isV2) {
      if (draftSave.pending) return;
      const result = validateLocalDraftV2FormState(state, baseModel, v2Questions);
      if (!result.ok) {
        setValidated(null);
        setErrors(result.errors);
        setStep(firstErrorStep(result.errors));
        setFocusRevision((revision) => revision + 1);
        setScreeningOpenToken((token) => token + 1);
        return;
      }
      setErrors({});
      void draftSave.save(result.model);
      return;
    }
    const result = validateDraftFormState(state, baseModel);
    if (!result.ok) {
      setValidated(null);
      setErrors(result.errors);
      setStep(firstErrorStep(result.errors));
      setFocusRevision((revision) => revision + 1);
      setScreeningOpenToken((token) => token + 1);
      return;
    }
    setErrors({});
    setValidated(result.model);
  }

  return (
    <div data-pf-local-draft-form="" className="flex flex-col gap-5">
      <div
        role="note"
        data-pf-local-draft-notice=""
        className="flex gap-2 rounded-2xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
      >
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>{isV2 ? DRAFT_SAVE_NOTICE : LOCAL_ONLY_NOTICE}</p>
      </div>

      <form noValidate onSubmit={handleValidate} className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <ol
            data-pf-draft-progress=""
            aria-label="Pasos del borrador"
            className="grid grid-cols-2 gap-2 sm:grid-cols-5"
          >
            {STEP_TITLES.map((title, index) => {
              const active = index === step;
              return (
                <li
                  key={title}
                  data-step={index + 1}
                  aria-current={active ? "step" : undefined}
                  className="flex min-w-0 items-center gap-2"
                >
                  <span
                    aria-hidden="true"
                    className={cn(RAIL_BASE, RAIL_STATE[stepStateOf(index, step)])}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 text-[11px] font-medium leading-tight text-foreground sm:text-xs">
                    {title}
                  </span>
                </li>
              );
            })}
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

        <section
          data-pf-draft-step="1"
          hidden={step !== 0}
          style={{ display: step === 0 ? undefined : "none" }}
          aria-labelledby="draft-step-heading-1"
          className="min-w-0"
        >
          <Card data-pf-draft-card="1">
            <DraftStepHeading
              index={0}
              title={STEP_TITLES[0]}
              headingRef={step === 0 ? stepHeadingRef : null}
            />
            <CardContent className="flex flex-col gap-6">
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={errors.title !== undefined}>
                  <FieldLabel htmlFor="draft-title">Título</FieldLabel>
                  <Input
                    id="draft-title"
                    name="title"
                    value={state.title}
                    autoComplete="off"
                    placeholder="Ej. Persona desarrolladora backend"
                    aria-invalid={errors.title !== undefined}
                    aria-describedby={
                      errors.title === undefined ? undefined : "draft-title-error"
                    }
                    onChange={(event) =>
                      applyState((previous) => ({ ...previous, title: event.target.value }), [
                        "title",
                      ])
                    }
                  />
                  <FieldError id="draft-title-error">{errors.title}</FieldError>
                </Field>

                <Field data-invalid={errors.location !== undefined}>
                  <FieldLabel htmlFor="draft-location">Ubicación</FieldLabel>
                  <Input
                    id="draft-location"
                    name="location"
                    value={state.location}
                    autoComplete="off"
                    placeholder="Ej. Ciudad de México"
                    aria-invalid={errors.location !== undefined}
                    aria-describedby={
                      errors.location === undefined ? undefined : "draft-location-error"
                    }
                    onChange={(event) =>
                      applyState((previous) => ({ ...previous, location: event.target.value }), [
                        "location",
                      ])
                    }
                  />
                  <FieldError id="draft-location-error">{errors.location}</FieldError>
                </Field>

                <DraftSelectField
                  id="draft-work-mode"
                  label="Modalidad"
                  placeholder="Elige una modalidad"
                  value={state.work_mode}
                  options={WORK_MODE_OPTIONS}
                  error={errors.work_mode}
                  onChange={(value) =>
                    applyState((previous) => ({ ...previous, work_mode: value }), ["work_mode"])
                  }
                />
              </FieldGroup>

              <Separator />

              <DraftStepSection id="draft-step-1-vacancy" title="Detalles de la vacante">
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <DraftSelectField
                    id="draft-work-schedule"
                    label="Jornada"
                    placeholder="Elige una jornada"
                    value={state.work_schedule}
                    options={WORK_SCHEDULE_OPTIONS}
                    error={errors.work_schedule}
                    onChange={(value) =>
                      applyState((previous) => ({ ...previous, work_schedule: value }), [
                        "work_schedule",
                      ])
                    }
                  />
                  <DraftSelectField
                    id="draft-contract-type"
                    label="Tipo de contrato"
                    placeholder="Elige un tipo de contrato"
                    value={state.contract_type}
                    options={CONTRACT_TYPE_OPTIONS}
                    error={errors.contract_type}
                    onChange={(value) =>
                      applyState((previous) => ({ ...previous, contract_type: value }), [
                        "contract_type",
                      ])
                    }
                  />
                  <DraftSelectField
                    id="draft-seniority"
                    label="Nivel"
                    placeholder="Elige un nivel"
                    value={state.seniority}
                    options={SENIORITY_OPTIONS}
                    error={errors.seniority}
                    onChange={(value) =>
                      applyState((previous) => ({ ...previous, seniority: value }), ["seniority"])
                    }
                  />
                  <DraftSelectField
                    id="draft-professional-area"
                    label="Área profesional"
                    placeholder="Elige un área"
                    value={state.professional_area}
                    options={PROFESSIONAL_AREA_OPTIONS}
                    error={errors.professional_area}
                    onChange={(value) =>
                      applyState((previous) => ({ ...previous, professional_area: value }), [
                        "professional_area",
                      ])
                    }
                  />
                </FieldGroup>
              </DraftStepSection>

              <Separator />

              <DraftStepSection id="draft-step-1-requester" title="Solicitante">
                <DraftRequesterField
                  requester={state.requester}
                  error={errors.requester}
                  onSelect={(entry) => applyState((previous) => selectRequester(previous, entry), ["requester"])}
                  onChangeKind={(kind) =>
                    applyState((previous) => changeRequesterKind(previous, kind), ["requester"])
                  }
                />
              </DraftStepSection>
            </CardContent>
            <DraftStepFooter
              onBack={() => goToStep(step - 1)}
              backDisabled
            >
              <Button type="button" onClick={() => goToStep(step + 1)}>
                Continuar
              </Button>
            </DraftStepFooter>
          </Card>
        </section>

        <section
          data-pf-draft-step="2"
          hidden={step !== 1}
          style={{ display: step === 1 ? undefined : "none" }}
          aria-labelledby="draft-step-heading-2"
          className="min-w-0"
        >
          <Card data-pf-draft-card="2">
            <DraftStepHeading
              index={1}
              title={STEP_TITLES[1]}
              headingRef={step === 1 ? stepHeadingRef : null}
            />
            <CardContent className="flex flex-col gap-6">
              <DraftStepSection id="draft-step-2-requirements" title="Requisitos">
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <DraftTextAreaField
                    id="draft-required-requirements"
                    label="Requisitos obligatorios"
                    value={state.required_requirements}
                    placeholder="Describe lo indispensable para el puesto."
                    error={errors.required_requirements}
                    onChange={(value) =>
                      applyState(
                        (previous) => ({ ...previous, required_requirements: value }),
                        ["required_requirements"],
                      )
                    }
                  />
                  <DraftTextAreaField
                    id="draft-preferred-requirements"
                    label="Requisitos deseables"
                    value={state.preferred_requirements}
                    placeholder="Describe lo que suma, sin ser obligatorio."
                    error={errors.preferred_requirements}
                    onChange={(value) =>
                      applyState(
                        (previous) => ({ ...previous, preferred_requirements: value }),
                        ["preferred_requirements"],
                      )
                    }
                  />
                </FieldGroup>
              </DraftStepSection>

              <Separator />

              <DraftStepSection id="draft-step-2-skills" title="Habilidades">
                <DraftListField
                  idPrefix="skill"
                  rowNoun="Habilidad"
                  addLabel="Agregar habilidad"
                  errorPrefix="skills"
                  max={100}
                  rows={state.skills}
                  errors={errors}
                  placeholder="Ej. Go"
                  onChange={(rows) =>
                    applyState((previous) => ({ ...previous, skills: rows }), ["skills"])
                  }
                />
              </DraftStepSection>

              <Separator />

              <DraftStepSection id="draft-step-2-languages" title="Idiomas">
                <DraftLanguageField
                  rows={state.languages}
                  errors={errors}
                  onChange={(rows) =>
                    applyState((previous) => ({ ...previous, languages: rows }), ["languages"])
                  }
                />
              </DraftStepSection>

              <Separator />

              <DraftStepSection id="draft-step-2-description" title="Descripción">
                <DraftDescriptionEditor
                  value={state.description}
                  error={errors.description}
                  onChange={(description) =>
                    applyState((previous) => ({ ...previous, description }), ["description"])
                  }
                />
              </DraftStepSection>
            </CardContent>
            <DraftStepFooter onBack={() => goToStep(step - 1)}>
              <Button type="button" onClick={() => goToStep(step + 1)}>
                Continuar
              </Button>
            </DraftStepFooter>
          </Card>
        </section>

        <section
          data-pf-draft-step="3"
          hidden={step !== 2}
          style={{ display: step === 2 ? undefined : "none" }}
          aria-labelledby="draft-step-heading-3"
          className="min-w-0"
        >
          <Card data-pf-draft-card="3">
            <DraftStepHeading
              index={2}
              title={STEP_TITLES[2]}
              headingRef={step === 2 ? stepHeadingRef : null}
            />
            <CardContent className="flex flex-col gap-6">
              <DraftStepSection id="draft-step-3-compensation" title="Compensación">
                <DraftCompensationField
                  value={state.compensation}
                  errors={errors}
                  onChange={(patch) =>
                    applyState((previous) => updateCompensation(previous, patch), ["compensation"])
                  }
                />
              </DraftStepSection>

              <Separator />

              <DraftStepSection id="draft-step-3-benefits" title="Prestaciones">
                <FieldGroup className="gap-6">
                  <DraftBenefitsField
                    selected={state.benefits}
                    onChange={(benefits) =>
                      applyState((previous) => ({ ...previous, benefits }), ["benefits"])
                    }
                  />
                  <DraftListField
                    idPrefix="custom-benefit"
                    rowNoun="Prestación adicional"
                    addLabel="Agregar prestación adicional"
                    errorPrefix="custom_benefits"
                    max={100}
                    rows={state.custom_benefits}
                    errors={errors}
                    placeholder="Ej. Café gratis"
                    onChange={(rows) =>
                      applyState((previous) => ({ ...previous, custom_benefits: rows }), [
                        "custom_benefits",
                      ])
                    }
                  />
                </FieldGroup>
              </DraftStepSection>
            </CardContent>
            <DraftStepFooter onBack={() => goToStep(step - 1)}>
              <Button type="button" onClick={() => goToStep(step + 1)}>
                Continuar
              </Button>
            </DraftStepFooter>
          </Card>
        </section>

        <section
          data-pf-draft-step="4"
          hidden={step !== 3}
          style={{ display: step === 3 ? undefined : "none" }}
          aria-labelledby="draft-step-heading-4"
          className="min-w-0"
        >
          <Card data-pf-draft-card="4">
            <DraftStepHeading
              index={3}
              title={STEP_TITLES[3]}
              headingRef={step === 3 ? stepHeadingRef : null}
            />
            <CardContent className="flex flex-col gap-6">
              <DraftStepSection id="draft-step-4-questions" title="Preguntas de filtro">
                {isV2 ? (
                  <DraftScreeningV2Field
                    questions={v2Questions}
                    errors={errors}
                    onChange={(next) => applyV2Questions(() => next)}
                    openFirstInvalidToken={screeningOpenToken}
                  />
                ) : (
                  <DraftListField
                    idPrefix="screening"
                    rowNoun="Pregunta"
                    addLabel="Agregar pregunta"
                    errorPrefix="screening_questions"
                    max={100}
                    multiline
                    rows={state.screening_questions}
                    errors={errors}
                    placeholder="Ej. ¿Cuántos años de experiencia tienes con React?"
                    onChange={(rows) =>
                      applyState((previous) => ({ ...previous, screening_questions: rows }), [
                        "screening_questions",
                      ])
                    }
                  />
                )}
              </DraftStepSection>
            </CardContent>
            <DraftStepFooter onBack={() => goToStep(step - 1)}>
              <Button type="button" onClick={() => goToStep(step + 1)}>
                Continuar
              </Button>
            </DraftStepFooter>
          </Card>
        </section>

        <section
          data-pf-draft-step="5"
          hidden={step !== LAST_STEP}
          style={{ display: step === LAST_STEP ? undefined : "none" }}
          aria-labelledby="draft-step-heading-5"
          className="min-w-0"
        >
          <Card data-pf-draft-card="5">
            <DraftStepHeading
              index={4}
              title={STEP_TITLES[LAST_STEP]}
              headingRef={step === LAST_STEP ? stepHeadingRef : null}
            />
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  {isV2
                    ? "Revisa lo que llevas capturado. Puedes guardar el borrador aunque falten campos. Solo se guarda cuando pulsas el botón."
                    : "Revisa lo que llevas capturado. Puedes validar el borrador aunque falten campos: los campos vacíos se validan como vacíos."}
                </p>
                <DraftPreview
                  state={state}
                  renderedQuestions={
                    isV2
                      ? v2Questions.map((question) => ({
                          id: question.id,
                          prompt: question.prompt,
                        }))
                      : undefined
                  }
                />
              </div>
            </CardContent>
            <DraftStepFooter onBack={() => goToStep(step - 1)}>
              <FieldError id="draft-model-error">{errors.model}</FieldError>
              {isV2 && candidateProjection !== null && !candidateProjection.ok ? (
                <p
                  role="status"
                  id="draft-questionnaire-preview-note"
                  data-pf-candidate-questionnaire-notice=""
                  className="text-sm text-muted-foreground"
                >
                  {SCREENING_V2_PREVIEW_INVALID}
                </p>
              ) : null}
              {isV2 ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={candidateProjection !== null && !candidateProjection.ok}
                  aria-describedby={
                    candidateProjection !== null && !candidateProjection.ok
                      ? "draft-questionnaire-preview-note"
                      : undefined
                  }
                  onClick={() => setPreviewOpen(true)}
                >
                  {QUESTIONNAIRE_DIALOG_OPEN}
                </Button>
              ) : null}
              {validated === null ? null : (
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-status-success"
                >
                  <CheckCircle2Icon aria-hidden="true" className="size-4" />
                  {VALIDATION_SUCCESS}
                </p>
              )}
              {isV2 ? (
                <div className="flex max-w-xl flex-col items-start gap-2">
                  <Button
                    type="submit"
                    className="min-h-10 min-w-40"
                    disabled={draftSave.pending}
                    aria-busy={draftSave.pending}
                    aria-describedby={draftSave.result ? "draft-save-status" : undefined}
                  >
                    {draftSave.pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
                    {draftSave.pending ? "Guardando…" : draftSave.saved ? "Guardar cambios" : "Guardar borrador"}
                  </Button>
                  <ActionStatusSlot>
                    <DraftSaveFeedback result={draftSave.result} dirty={draftSave.dirty} />
                  </ActionStatusSlot>
                </div>
              ) : <Button type="submit">Validar borrador</Button>}
            </DraftStepFooter>
          </Card>
        </section>
      </form>

      {isV2 && candidateProjection !== null ? (
        <DraftQuestionnaireDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          projection={candidateProjection}
        />
      ) : null}
    </div>
  );
}
