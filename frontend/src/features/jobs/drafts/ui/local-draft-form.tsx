"use client";

import * as React from "react";
import type { GeographyErrors, LocationValue } from "@/features/geo/model";
import { DraftGeographyField } from "./draft-geography-field";
import {
  CheckCircle2Icon,
  InfoIcon,
} from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDraftSave, type DraftIdentity } from "./draft-save-state";
import { DRAFT_SAVE_NOTICE, DraftSaveFeedback } from "./draft-save-feedback";
import { ActionBar } from "@/components/feedback/action-status";
import { Card,
  CardAction,
  CardContent,
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
import { DraftEditorShell, EDITOR_SECTIONS, EDITOR_DESCRIPTIONS } from "./draft-editor-shell";
import { DraftLeaveGuard } from "./draft-leave-guard";
import { editorReadiness } from "../pipeline/publication-model";
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
import { PublishButton } from "@/features/employer-vacancies/publication/publish-dialog";
import { loadDraftPublicationAction } from "../pipeline/publication-actions";
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
  /** Identity from the detail GET, never the list's version. */
  initialIdentity?: DraftIdentity;
};

/** Approved step order and visible titles. */
const STEP_TITLES = EDITOR_SECTIONS;
const STEP_COUNT = STEP_TITLES.length;
const LAST_STEP = STEP_COUNT - 1;

/** Contract field keys owned by each step, used to route validation errors. */
const STEP_ERROR_PREFIXES: readonly (readonly string[])[] = [
  [
    "title",
    "location",
    "remote_scope",
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
 * section alongside the visible "N de M" counter. Readiness is independent.
 */
function DraftStepHeading({
  index,
  title,
  headingRef,
}: {
  index: number;
  title: string;
  headingRef: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <CardHeader>
      <CardTitle><h2
        ref={headingRef}
        id={`draft-step-heading-${index + 1}`}
        tabIndex={-1}
        className="text-lg outline-none"
      >
        <span className="sr-only">{`Paso ${index + 1} de ${STEP_COUNT}: `}</span>
        {title}
      </h2></CardTitle>
      <CardAction><span className="text-sm text-muted-foreground">{index + 1} de {STEP_COUNT}</span></CardAction>
      <p className="text-sm text-muted-foreground">{EDITOR_DESCRIPTIONS[index]}</p>
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
  onEditQuestions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projection: CandidateScreeningProjection;
  onEditQuestions: () => void;
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
            <DraftQuestionnairePreview questions={projection.questions} onEditQuestions={onEditQuestions} />
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
  initialIdentity,
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
  const draftSave = useDraftSave(initialIdentity);
  const [savedDraftId, setSavedDraftId] = React.useState(initialIdentity?.draftId);
  const [published, setPublished] = React.useState<boolean | null>(initialIdentity ? null : false);
  const [serverMissing, setServerMissing] = React.useState<readonly string[] | null>(null);
  const [publishNotice, setPublishNotice] = React.useState(false);
  const readiness = editorReadiness(state, serverMissing);
  const savedResultId = draftSave.result?.ok ? draftSave.result.draftId : undefined;
  React.useEffect(() => { if (savedResultId) setSavedDraftId(savedResultId); }, [savedResultId]);
  React.useEffect(() => {
    if (!savedDraftId) return;
    let current = true;
    void loadDraftPublicationAction(savedDraftId).then(result => {
      if (current && result.ok) {
        setPublished(result.publication.status === "published");
        setServerMissing(result.publication.missing);
      }
    }).catch(() => { /* The dialog will expose an explicit retry if the read remains unavailable. */ });
    return () => { current = false; };
  }, [savedDraftId]);
  const [errors, setErrors] = React.useState<DraftFormErrors>({});
  const [geographyErrors, setGeographyErrors] = React.useState<GeographyErrors>();
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
  const stepHeadingRef = React.useRef<HTMLHeadingElement | null>(null);
  const hasMountedRef = React.useRef(false);
  const focusTarget = React.useRef<string | null>(null);
  React.useEffect(() => {
    function openField(hash: string) {
      if (hash !== "#draft-location" && hash !== "#draft-remote-scope") return;
      focusTarget.current = hash;
      setStep(0);
      setFocusRevision(revision => revision + 1);
    }
    const followAnchor = () => openField(window.location.hash);
    // Next's same-route Link uses pushState, which does not emit hashchange.
    function followLink(event: MouseEvent) {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (link && link.origin === window.location.origin && link.pathname === window.location.pathname && (!link.target || link.target === "_self")) openField(link.hash);
    }
    followAnchor();
    window.addEventListener("hashchange", followAnchor);
    document.addEventListener("click", followLink);
    return () => {
      window.removeEventListener("hashchange", followAnchor);
      document.removeEventListener("click", followLink);
    };
  }, []);

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
    const selector = focusTarget.current;
    focusTarget.current = null;
    const target = selector ? document.querySelector<HTMLElement>(selector) : null;
    (target ?? document.querySelector<HTMLElement>(`[data-pf-draft-step="${step + 1}"] [aria-invalid="true"]`) ?? stepHeadingRef.current)?.focus();
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
    if (errorPrefixes.some(prefix => prefix === "location" || prefix === "remote_scope")) setGeographyErrors(undefined);
    draftSave.edited();
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
      void draftSave.save(result.model).then(response => {
        if (response && !response.ok && "geography" in response && response.geography) {
          setGeographyErrors(response.geography);
          focusTarget.current = '[data-pf-draft-step="1"] [aria-invalid="true"]';
          setStep(0);
          setFocusRevision(revision => revision + 1);
        }
      });
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
        <p className="max-w-prose">{isV2 ? DRAFT_SAVE_NOTICE : LOCAL_ONLY_NOTICE}</p>
      </div>

      <form noValidate onSubmit={handleValidate} className="flex flex-col gap-6">
        <DraftEditorShell state={state} published={published} step={step} onStep={goToStep} readiness={readiness}>

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
                <DraftGeographyField
                  state={state}
                  errors={geographyErrors ?? {
                    location: Object.keys(errors).filter(key => key.startsWith("location.")).map(key => ({ field: key.split(".")[1] as keyof LocationValue, reason: "unknown" })),
                    remoteScope: [],
                  }}
                  remoteError={Object.entries(errors).find(([key]) => key.startsWith("remote_scope"))?.[1]}
                  onChange={patch => applyState(previous => ({ ...previous, ...patch }), ["location", "remote_scope"])}
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
                <p className="max-w-prose text-sm text-muted-foreground">
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
                  className="min-h-10 w-full self-start sm:w-auto"
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
            </CardContent>

          </Card>
        </section>
        <div className="mt-6 flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" className="min-h-10" disabled={step === 0} onClick={() => goToStep(step - 1)}>Anterior</Button>
          {step < LAST_STEP && <Button type="button" variant="outline" className="min-h-10" onClick={() => goToStep(step + 1)}>Siguiente sección</Button>}
        </div>
        </DraftEditorShell>
        <footer data-pf-draft-save-bar="" className="sticky bottom-0 z-20 border-t bg-card px-4 py-4">
          <ActionBar status={<div className="flex flex-col gap-1">
            {isV2 ? <DraftSaveFeedback result={draftSave.result} dirty={draftSave.dirty} /> : null}
            {!draftSave.result && <p className="text-sm text-muted-foreground">{draftSave.dirty ? "Cambios sin guardar" : draftSave.saved ? "Sin cambios pendientes" : "Borrador sin guardar"}</p>}
            <p className="text-xs text-muted-foreground">Sin guardado automático</p>
            {publishNotice && (!savedDraftId || draftSave.dirty) && <p className="text-sm text-muted-foreground">Guarda los cambios antes de publicar</p>}
          </div>}>
            <FieldError id="draft-model-error">{errors.model}</FieldError>
            {validated !== null && <p role="status" className="flex items-center gap-2 text-sm text-status-success"><CheckCircle2Icon aria-hidden="true" className="size-4" />{VALIDATION_SUCCESS}</p>}
            <div className="flex flex-wrap gap-2">
              {isV2 ? <Button type="submit" variant="outline" className="min-h-10" disabled={draftSave.pending} aria-busy={draftSave.pending} aria-describedby={draftSave.result ? "draft-save-status" : undefined}>
                {draftSave.pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
                {draftSave.pending ? "Guardando…" : draftSave.saved ? "Guardar cambios" : "Guardar borrador"}
              </Button> : <Button type="submit" variant="outline" className="min-h-10">Validar borrador</Button>}
              {isV2 && (savedDraftId && !published ? <PublishButton draftId={savedDraftId} label="Publicar vacante" variant="default" unsavedChanges={draftSave.dirty || draftSave.pending} onPublished={() => setPublished(true)} /> : <Button type="button" className="min-h-10" disabled={published === true} onClick={() => setPublishNotice(true)}>{published ? "Activa" : "Publicar vacante"}</Button>)}
            </div>
          </ActionBar>
        </footer>
      </form>
      <DraftLeaveGuard dirty={draftSave.dirty} />

      {isV2 && candidateProjection !== null ? (
        <DraftQuestionnaireDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          projection={candidateProjection}
          onEditQuestions={() => { setPreviewOpen(false); goToStep(3); }}
        />
      ) : null}
    </div>
  );
}
