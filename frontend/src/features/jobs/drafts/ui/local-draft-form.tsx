"use client";

import * as React from "react";
import type { GeographyErrors, LocationValue } from "@/features/geo/model";
import { draftValidationErrors } from "../validation-errors";
import { DraftGeographyField } from "./draft-geography-field";
import {
  CheckCircle2Icon,
  InfoIcon,
  BriefcaseBusiness,
  MapPin,
  LockKeyhole,
  Play,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PublicationRequired } from "./publication-required";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDraftSave, type DraftIdentity } from "./draft-save-state";
import { DraftSaveFeedback } from "./draft-save-feedback";
import { ActionBar } from "@/components/feedback/action-status";
import { TabsContent } from "@/components/ui/tabs";
import { Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldSet,
  FieldLegend,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS } from "@/features/candidate/model";
import { DraftEditorShell, EDITOR_SECTIONS, EDITOR_DESCRIPTIONS } from "./draft-editor-shell";
import { DraftLeaveGuard, type DraftLeaveGuardHandle } from "./draft-leave-guard";
import { editorReadiness, editorPublicationRequirements } from "../pipeline/publication-model";
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
import { DraftReviewSection } from "./draft-review-section";
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
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import { publicationStatus } from "@/features/vacancy-lifecycle/publication-status";

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
  initialLifecycle?: Lifecycle;
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
  ["required_requirements", "preferred_requirements", "skills", "languages", "description", "min_years_of_experience", "min_education_level", "accepts_in_progress_education"],
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
  return <header className="grid grid-cols-[1fr_auto] items-start gap-2">
    <h2 ref={headingRef} id={`draft-step-heading-${index + 1}`} tabIndex={-1} className="font-heading text-lg font-semibold outline-none"><span className="sr-only">{`Paso ${index + 1} de ${STEP_COUNT}: `}</span>{title}</h2>
    <span className="text-sm text-muted-foreground">{index + 1} de {STEP_COUNT}</span>
    <p className="col-span-2 text-sm text-muted-foreground">{EDITOR_DESCRIPTIONS[index]}</p>
  </header>;
}

/** v0 topic surface using the installed Card's complete header/content anatomy. */
function DraftStepSection({ id, title, description, action, children }: {
  id: string;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return <Card aria-labelledby={headingId} data-pf-topic-card="" className="[--card-spacing:--spacing(6)]">
    <CardHeader>
      <CardTitle><h3 id={headingId}>{title}</h3></CardTitle>
      <CardDescription>{description}</CardDescription>
      {action && <CardAction>{action}</CardAction>}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>;
}

/** One labelled enum select reused by every scalar group. */
function DraftSelectField({
  id,
  label,
  value,
  options,
  placeholder,
  error,
  publicationRequired = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  publicationRequired?: boolean;
  options: DraftOption[];
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  return (
    <Field data-invalid={error !== undefined}>
      <FieldTitle id={labelId}>{label} <PublicationRequired required={publicationRequired} /></FieldTitle>
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
        className="min-h-28"
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
  initialLifecycle,
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
  const leaveGuard = React.useRef<DraftLeaveGuardHandle>(null);
  const draftSave = useDraftSave(initialIdentity, leaveGuard);
  const [savedDraftId, setSavedDraftId] = React.useState(initialIdentity?.draftId);
  const [published, setPublished] = React.useState<boolean | null>(initialLifecycle ? initialLifecycle.publication !== null : initialIdentity ? null : false);
  const publication = initialLifecycle?.publication ?? (published === null ? undefined : published ? "published" : null);
  const status = publicationStatus(publication, "success", initialLifecycle?.process);
  const [serverMissing, setServerMissing] = React.useState<readonly string[] | null>(null);
  const [publishNotice, setPublishNotice] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const readiness = editorReadiness(state, serverMissing);
  const publicationRequired = editorPublicationRequirements(state);
  const savedResultId = draftSave.result?.ok ? draftSave.result.draftId : undefined;
  React.useEffect(() => { if (savedResultId) setSavedDraftId(savedResultId); }, [savedResultId]);
  React.useEffect(() => {
    if (!savedDraftId) return;
    let current = true;
    void loadDraftPublicationAction(savedDraftId).then(result => {
      if (current && result.ok) {
        setPublished(initialLifecycle?.publication != null || result.publication.status === "published");
        setServerMissing(result.publication.missing);
      }
    }).catch(() => { /* The dialog will expose an explicit retry if the read remains unavailable. */ });
    return () => { current = false; };
  }, [savedDraftId, initialLifecycle]);
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
    // Tabs own roving keyboard focus; explicit error routing still focuses its field.
    if (!selector && document.activeElement?.getAttribute("role") === "tab") return;
    const target = selector ? document.querySelector<HTMLElement>(selector) : null;
    (target ?? document.querySelector<HTMLElement>(`[data-pf-draft-step="${step + 1}"] [aria-invalid="true"]`) ?? stepHeadingRef.current)?.focus();
  }, [step, focusRevision]);

  function completeReviewItem(code: string) {
    const targets: Record<string, string> = {
      title_missing: "#draft-title", description_missing: "#draft-description-content",
      work_mode_missing: "#draft-work-mode", work_schedule_missing: "#draft-work-schedule",
      contract_type_missing: "#draft-contract-type", professional_area_missing: "#draft-professional-area",
      requester_missing: '[aria-labelledby="draft-requester-name-label"]',
      location_missing: '#draft-location input[role="combobox"]',
      location_incomplete: `#draft-location [data-slot="field-group"] [data-slot="field-group"] > [data-slot="field"]:nth-child(${state.location.state ? 2 : 1}) input[role="combobox"]`,
      remote_scope_missing: state.remote_scope?.kind === "countries" ? "#draft-remote-countries" : '#draft-remote-scope button',
    };
    focusTarget.current = Object.hasOwn(targets, code) ? targets[code] : "#draft-step-heading-5";
    setStep(code === "description_missing" ? 1 : Object.hasOwn(targets, code) ? 0 : LAST_STEP);
    setFocusRevision(revision => revision + 1);
  }

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
        if (response && !response.ok && "fields" in response && response.fields) {
          const mapped = draftValidationErrors(response.fields);
          setErrors(mapped);
          setStep(firstErrorStep(mapped));
          setFocusRevision(revision => revision + 1);
        }
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
      {!isV2 && <div
        role="note"
        data-pf-local-draft-notice=""
        className="flex gap-2 rounded-2xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
      >
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p className="max-w-prose">{LOCAL_ONLY_NOTICE}</p>
      </div>}

      <form ref={formRef} noValidate aria-describedby="draft-publication-footnote" onSubmit={handleValidate} className="flex flex-col gap-6">
        <DraftEditorShell state={state} published={published} publication={publication} process={initialLifecycle?.process} step={step} onStep={goToStep} readiness={readiness}>

        <TabsContent value={0} keepMounted
          data-pf-draft-step="1"
          hidden={step !== 0}
          style={{ display: step === 0 ? undefined : "none" }}
          aria-labelledby="draft-step-heading-1"
          className="min-w-0"
        >
          <div data-pf-draft-section="1" className="flex flex-col gap-5">
            <DraftStepHeading
              index={0}
              title={STEP_TITLES[0]}
              headingRef={step === 0 ? stepHeadingRef : null}
            />
            <DraftStepSection id="draft-step-1-vacancy" title="El puesto que estás buscando" description="Empieza por lo esencial para conectar con las personas correctas." action={<BriefcaseBusiness aria-hidden="true" className="size-5 text-muted-foreground" />}>
              <FieldGroup>
                <Field data-invalid={errors.title !== undefined}>
                  <FieldLabel htmlFor="draft-title">Título de la vacante <PublicationRequired required={publicationRequired.scalarFields.includes("title")} /></FieldLabel>
                  <Input
                    id="draft-title"
                    name="title"
                    aria-label="Título"
                    className="min-h-10"
                    value={state.title}
                    autoComplete="off"
                    placeholder="Ej. Diseñador/a de producto"
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
                  <FieldDescription>Usa un título claro y fácil de encontrar.</FieldDescription>
                  <FieldError id="draft-title-error">{errors.title}</FieldError>
                </Field>
                <FieldGroup className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
                  {([
                    ["professional_area", "draft-professional-area", "Área profesional", PROFESSIONAL_AREA_OPTIONS, "Elige un área"],
                    ["seniority", "draft-seniority", "Nivel", [{ value: "", label: "Sin especificar" }, ...SENIORITY_OPTIONS], "Elige un nivel"],
                    ["work_schedule", "draft-work-schedule", "Jornada", WORK_SCHEDULE_OPTIONS, "Elige una jornada"],
                    ["contract_type", "draft-contract-type", "Tipo de contrato", CONTRACT_TYPE_OPTIONS, "Elige un tipo de contrato"],
                  ] as const).map(([key, id, label, options, placeholder]) => <DraftSelectField key={key} id={id} label={label} options={[...options]} placeholder={placeholder} value={state[key]} error={errors[key]} publicationRequired={publicationRequired.scalarFields.some(field => field === key)} onChange={value => applyState(previous => ({ ...previous, [key]: value }), [key])} />)}
                </FieldGroup>
              </FieldGroup>
            </DraftStepSection>
            <DraftStepSection id="draft-step-1-geography" title="¿Dónde trabajará?" description="Define la modalidad y la ubicación de la vacante." action={<MapPin aria-hidden="true" className="size-5 text-muted-foreground" />}>
              <FieldGroup>
                <DraftSelectField
                  id="draft-work-mode"
                  publicationRequired={publicationRequired.scalarFields.includes("work_mode")}
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
                  defaultCountry={savedDraftId ? null : "MX"}
                  errors={geographyErrors ?? {
                    location: Object.keys(errors).filter(key => key.startsWith("location.")).map(key => ({ field: key.split(".")[1] as keyof LocationValue, reason: "unknown" })),
                    remoteScope: [],
                  }}
                  remoteError={Object.entries(errors).find(([key]) => key.startsWith("remote_scope"))?.[1]}
                  onChange={patch => applyState(previous => ({ ...previous, ...patch }), ["location", "remote_scope"])}
                />
              </FieldGroup>
            </DraftStepSection>
            <DraftStepSection id="draft-step-1-requester" title="Solicitante" description="¿Quién necesita cubrir esta posición?" action={<Badge variant="secondary"><LockKeyhole aria-hidden="true" />Solo interno</Badge>}>
                <DraftRequesterField
                  requester={state.requester}
                  publicationRequired={publicationRequired.requester}
                  error={errors.requester}
                  onSelect={(entry) => applyState((previous) => selectRequester(previous, entry), ["requester"])}
                  onChangeKind={(kind) =>
                    applyState((previous) => changeRequesterKind(previous, kind), ["requester"])
                  }
                />
            </DraftStepSection>
          </div>
        </TabsContent>

        <TabsContent value={1} keepMounted
          data-pf-draft-step="2"
          hidden={step !== 1}
          style={{ display: step === 1 ? undefined : "none" }}
          aria-labelledby="draft-step-heading-2"
          className="min-w-0"
        >
          <div data-pf-draft-section="2" className="flex flex-col gap-5">
            <DraftStepHeading
              index={1}
              title={STEP_TITLES[1]}
              headingRef={step === 1 ? stepHeadingRef : null}
            />
              <DraftStepSection id="draft-step-2-description" title="Cuéntales sobre la oportunidad" description="Una buena descripción ayuda a imaginar cómo será trabajar aquí.">
                <FieldGroup>
                  <DraftDescriptionEditor value={state.description} publicationRequired={publicationRequired.description} error={errors.description} onChange={description => applyState(previous => ({ ...previous, description }), ["description"])} />
                  <DraftTextAreaField
                    id="draft-required-requirements"
                    label="Requisitos obligatorios"
                    value={state.required_requirements}
                    placeholder="Lo indispensable para desempeñar el puesto."
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
                    placeholder="Lo que suma, sin ser obligatorio."
                    error={errors.preferred_requirements}
                    onChange={(value) =>
                      applyState(
                        (previous) => ({ ...previous, preferred_requirements: value }),
                        ["preferred_requirements"],
                      )
                    }
                  />
                  <FieldDescription>Estos requisitos informan y ayudan a filtrar; nunca rechazan automáticamente una postulación.</FieldDescription>
                  <FieldGroup className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
                    <Field data-invalid={!!errors.min_years_of_experience}>
                      <FieldLabel htmlFor="draft-min-years">Experiencia mínima (años)</FieldLabel>
                      <Input id="draft-min-years" className="min-h-10" inputMode="decimal" value={state.min_years_of_experience} aria-invalid={!!errors.min_years_of_experience} aria-describedby="draft-min-years-help draft-min-years-error" onChange={event => applyState(previous => ({ ...previous, min_years_of_experience: event.target.value }), ["min_years_of_experience"])} />
                      <FieldDescription id="draft-min-years-help">Mínimo requerido; puedes usar decimales, por ejemplo 1.5.</FieldDescription>
                      <FieldError id="draft-min-years-error">{errors.min_years_of_experience}</FieldError>
                    </Field>
                    <DraftSelectField id="draft-min-education" label="Estudios mínimos" placeholder="Sin especificar" options={[{ value: "", label: "Sin especificar" }, ...EDUCATION_LEVELS.map(value => ({ value, label: EDUCATION_LEVEL_LABELS[value] }))]} value={state.min_education_level} error={errors.min_education_level} onChange={value => applyState(previous => ({ ...previous, min_education_level: value, accepts_in_progress_education: value ? previous.accepts_in_progress_education : false }), ["min_education_level", "accepts_in_progress_education"])} />
                  </FieldGroup>
                  {/* Only meaningful once a minimum level exists; kept visible when checked or reported by the server. */}
                  {(state.min_education_level || state.accepts_in_progress_education || errors.accepts_in_progress_education) && <Field data-invalid={!!errors.accepts_in_progress_education}>
                    <Field orientation="horizontal">
                      <Checkbox id="draft-accepts-in-progress" checked={state.accepts_in_progress_education} aria-invalid={!!errors.accepts_in_progress_education} aria-describedby="draft-accepts-in-progress-error" onCheckedChange={checked => applyState(previous => ({ ...previous, accepts_in_progress_education: checked }), ["accepts_in_progress_education"])} />
                      <FieldLabel htmlFor="draft-accepts-in-progress">Acepta estudios en curso</FieldLabel>
                    </Field>
                    <FieldError id="draft-accepts-in-progress-error">{errors.accepts_in_progress_education}</FieldError>
                  </Field>}
                </FieldGroup>
              </DraftStepSection>

              <DraftStepSection id="draft-step-2-skills" title="Habilidades e idiomas" description="Define los conocimientos que aportarán al equipo.">
                <FieldGroup>
                <FieldSet><FieldLegend>Habilidades</FieldLegend>
                <DraftListField
                  idPrefix="skill"
                  rowNoun="Habilidad"
                  addLabel="Agregar habilidad"
                  errorPrefix="skills"
                  max={100}
                  rows={state.skills}
                  errors={errors}
                  placeholder="Ej. Diseño de interfaces"
                  onChange={(rows) =>
                    applyState((previous) => ({ ...previous, skills: rows }), ["skills"])
                  }
                />
                </FieldSet>
                <Separator />
                <FieldSet><FieldLegend>Idiomas</FieldLegend>
                <DraftLanguageField
                  rows={state.languages}
                  errors={errors}
                  onChange={(rows) =>
                    applyState((previous) => ({ ...previous, languages: rows }), ["languages"])
                  }
                />
                </FieldSet>
                </FieldGroup>
              </DraftStepSection>
          </div>
        </TabsContent>

        <TabsContent value={2} keepMounted
          data-pf-draft-step="3"
          hidden={step !== 2}
          style={{ display: step === 2 ? undefined : "none" }}
          aria-labelledby="draft-step-heading-3"
          className="min-w-0"
        >
          <div data-pf-draft-section="3" className="flex flex-col gap-5">
            <DraftStepHeading
              index={2}
              title={STEP_TITLES[2]}
              headingRef={step === 2 ? stepHeadingRef : null}
            />
              <DraftStepSection id="draft-step-3-compensation" title="Una oferta clara desde el inicio" description="Define la compensación y decide qué compartir públicamente.">
                <DraftCompensationField
                  value={state.compensation}
                  errors={errors}
                  onChange={(patch) =>
                    applyState((previous) => updateCompensation(previous, patch), ["compensation"])
                  }
                />
              </DraftStepSection>

              <DraftStepSection id="draft-step-3-benefits" title="Más que un sueldo" description="Comparte las prestaciones que hacen diferente esta oportunidad.">
                <FieldGroup className="gap-6">
                  <DraftBenefitsField
                    selected={state.benefits}
                    onChange={(benefits) =>
                      applyState((previous) => ({ ...previous, benefits }), ["benefits"])
                    }
                  />
                  <Separator />
                  <FieldSet><FieldLegend>Prestaciones adicionales</FieldLegend>
                  <DraftListField
                    idPrefix="custom-benefit"
                    rowNoun="Prestación adicional"
                    addLabel="Agregar prestación adicional"
                    errorPrefix="custom_benefits"
                    max={100}
                    rows={state.custom_benefits}
                    errors={errors}
                    placeholder="Ej. Viernes con horario reducido"
                    onChange={(rows) =>
                      applyState((previous) => ({ ...previous, custom_benefits: rows }), [
                        "custom_benefits",
                      ])
                    }
                  />
                  </FieldSet>
                </FieldGroup>
              </DraftStepSection>
          </div>
        </TabsContent>

        <TabsContent value={3} keepMounted
          data-pf-draft-step="4"
          hidden={step !== 3}
          style={{ display: step === 3 ? undefined : "none" }}
          aria-labelledby="draft-step-heading-4"
          className="min-w-0"
        >
          <div data-pf-draft-section="4" className="flex flex-col gap-5">
            <DraftStepHeading
              index={3}
              title={STEP_TITLES[3]}
              headingRef={step === 3 ? stepHeadingRef : null}
            />
              <DraftStepSection id="draft-step-4-questions" title="Conoce mejor a quienes se postulan" description={`Preguntas de filtro opcionales · ${isV2 ? v2Questions.length : state.screening_questions.length} de 100`} action={<Badge variant="secondary">Opcional</Badge>}>
                {isV2 ? (
                  <FieldGroup>
                  <DraftScreeningV2Field
                    questions={v2Questions}
                    errors={errors}
                    onChange={(next) => applyV2Questions(() => next)}
                    openFirstInvalidToken={screeningOpenToken}
                  />
                  {v2Questions.length > 0 && <div className="flex flex-col items-start gap-2">
                    <Button type="button" variant="outline" className="min-h-10" disabled={!candidateProjection?.ok} aria-describedby={!candidateProjection?.ok ? "draft-questions-preview-help" : undefined} onClick={() => setPreviewOpen(true)}><Play aria-hidden="true" data-icon="inline-start" />{QUESTIONNAIRE_DIALOG_OPEN}</Button>
                    {!candidateProjection?.ok && <FieldDescription id="draft-questions-preview-help">{SCREENING_V2_PREVIEW_INVALID}</FieldDescription>}
                  </div>}
                  </FieldGroup>
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
          </div>
        </TabsContent>

        <TabsContent value={4} keepMounted
          data-pf-draft-step="5"
          hidden={step !== LAST_STEP}
          style={{ display: step === LAST_STEP ? undefined : "none" }}
          aria-labelledby="draft-step-heading-5"
          className="min-w-0"
        >
          <div className="flex flex-col gap-5">
            <DraftStepHeading
              index={4}
              title={STEP_TITLES[LAST_STEP]}
              headingRef={step === LAST_STEP ? stepHeadingRef : null}
            />
            <DraftReviewSection state={state} readiness={readiness} draftId={savedDraftId} published={published} questionCount={isV2 ? v2Questions.length : state.screening_questions.length} onComplete={completeReviewItem} questionnaireAction={<>
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
                  variant="link"
                  className="min-h-10"
                  disabled={candidateProjection !== null && !candidateProjection.ok}
                  aria-describedby={
                    candidateProjection !== null && !candidateProjection.ok
                      ? "draft-questionnaire-preview-note"
                      : undefined
                  }
                  onClick={() => setPreviewOpen(true)}
                >
                  Revisar y probar
                </Button>
              ) : <Button type="button" variant="link" className="min-h-10" onClick={() => goToStep(3)}>Revisar preguntas</Button>}
            </>} />
          </div>
        </TabsContent>
        <div className="mt-6 flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" className="min-h-10" disabled={step === 0} onClick={() => goToStep(step - 1)}>Anterior</Button>
          {step < LAST_STEP && <Button type="button" variant="outline" className="min-h-10" onClick={() => goToStep(step + 1)}>Siguiente sección</Button>}
          {step === LAST_STEP && isV2 && (savedDraftId && !published ? <PublishButton draftId={savedDraftId} label="Revisar y publicar" variant="default" unsavedChanges={draftSave.dirty || draftSave.pending} onPublished={() => setPublished(true)} /> : <Button type="button" className="min-h-10" disabled={published === true} onClick={() => setPublishNotice(true)}>{published ? publication === "published" ? "Vacante activa" : status.label : "Revisar y publicar"}</Button>)}
        </div>
        <p id="draft-publication-footnote" className="mt-5 text-center text-sm text-muted-foreground"><span className="text-primary">*</span> Necesario para publicar, no para guardar tu borrador.</p>
        </DraftEditorShell>
        <footer data-pf-draft-save-bar="" className="sticky bottom-4 z-20 w-full pb-[env(safe-area-inset-bottom)]">
          {/* A standalone action surface, like the toolbar Card in §13.12: no redundant heading or footer. */}
          <Card size="sm" className="rounded-xl bg-card/95 backdrop-blur ring-1 ring-foreground/10 shadow-sm">
          <CardContent className="[&>[data-pf-action-bar]]:flex-wrap [&_[data-pf-action-bar-actions]]:w-full sm:[&_[data-pf-action-bar-actions]]:w-auto">
          <ActionBar status={<div className="flex flex-col gap-1">
            {isV2 ? <DraftSaveFeedback result={draftSave.result} dirty={draftSave.dirty} /> : null}
            {!draftSave.result && <p className="text-sm text-muted-foreground">{draftSave.dirty ? "Cambios sin guardar" : draftSave.saved ? "Sin cambios pendientes" : "Borrador sin guardar"}</p>}
            <p className="text-xs text-muted-foreground">Sin guardado automático</p>
          </div>}>
            <FieldError id="draft-model-error">{errors.model}</FieldError>
            {validated !== null && <p role="status" className="flex items-center gap-2 text-sm text-status-success"><CheckCircle2Icon aria-hidden="true" className="size-4" />{VALIDATION_SUCCESS}</p>}
            <div data-pf-draft-save-actions="" className="flex w-full flex-col gap-2 sm:flex-row">
              {isV2 ? <Button type="submit" variant="outline" className="min-h-10" disabled={draftSave.pending} aria-busy={draftSave.pending} aria-describedby={draftSave.result ? "draft-save-status" : undefined}>
                {draftSave.pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
                {draftSave.pending ? "Guardando…" : draftSave.saved ? "Guardar cambios" : "Guardar borrador"}
              </Button> : <Button type="submit" variant="outline" className="min-h-10">Validar borrador</Button>}
              {isV2 && (savedDraftId && !published ? <PublishButton draftId={savedDraftId} label="Publicar vacante" variant="default" unsavedChanges={draftSave.dirty || draftSave.pending} onPublished={() => setPublished(true)} /> : <Button type="button" className="min-h-10" disabled={published === true} onClick={() => setPublishNotice(true)}>{published ? status.label : "Publicar vacante"}</Button>)}
            </div>
          </ActionBar>
          </CardContent>
          </Card>
        </footer>
      </form>
      {/* A never-saved draft has no id to publish: say so in a dialog (shadcn «With Form» structure) instead of a muted note. */}
      <Dialog open={publishNotice && !savedDraftId} onOpenChange={setPublishNotice}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guarda los cambios antes de publicar</DialogTitle>
            <DialogDescription>Para revisar y publicar la vacante, primero guarda el borrador. Después verás qué falta completar.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="min-h-10" />}>Cancelar</DialogClose>
            <Button type="button" className="min-h-10" onClick={() => { setPublishNotice(false); formRef.current?.requestSubmit(); }}>Guardar borrador</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DraftLeaveGuard ref={leaveGuard} dirty={draftSave.dirty} />

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
