"use client";

import { cn } from "cn";
import { useGeoCatalog } from "@/features/geo/use-geo-catalog";
import {
  BanknoteIcon,
  CheckCircle2Icon,
  CircleHelpIcon,
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  GlobeIcon,
  GiftIcon,
  LanguagesIcon,
  LayoutGridIcon,
  ListChecksIcon,
  LockIcon,
  MapPinIcon,
  SparklesIcon,
  TrendingUpIcon,
  UserRoundIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { compensationSchema } from "../compensation";
import { previewSalaryParts } from "../../create/form/preview-salary";
import { BENEFITS } from "../lists";
import { draftLanguagesSchema } from "../nested";
import type { DraftCompensationState, DraftFormState } from "./draft-form-state";
import {
  BASIS_OPTIONS,
  CONTRACT_TYPE_OPTIONS,
  LANGUAGE_LEVEL_OPTIONS,
  LANGUAGE_OPTIONS,
  PAY_PERIOD_OPTIONS,
  PROFESSIONAL_AREA_OPTIONS,
  REQUESTER_KIND_OPTIONS,
  SENIORITY_OPTIONS,
  WORK_MODE_OPTIONS,
  WORK_SCHEDULE_OPTIONS,
  benefitLabel,
  type DraftOption,
} from "./draft-labels";
import {
  DraftRichDescriptionContent,
  resolveDraftRichDescription,
} from "./draft-rich-description";

/**
 * Final-step truth preview of the raw local draft state.
 *
 * Two independent, honest regions over the same raw values:
 *   - a public look with the actual basics, requirements, rich description and
 *     lists a candidate would read, the requester excluded (REQ-4) and salary
 *     shown only under explicit `public_visible` (VAC-4, SAL-4);
 *   - an internal review with the requester, the screening prompts and the
 *     compensation visibility status.
 *
 * It is presentational only: it reads the raw state, never mutates or
 * normalizes it, owns no request/storage/navigation, and never interprets
 * user HTML. The rich description is validated with the complete approved rich
 * schema and rendered as safe React nodes. Valid money uses the public salary
 * formatter without numeric conversion or mutations to the raw editor state.
 */

const NOT_DEFINED_TITLE = "Título sin definir";
const NO_DESCRIPTION = "Sin descripción todavía.";
const DESCRIPTION_UNAVAILABLE = "La descripción todavía no se puede mostrar.";
const NO_SELECTION = "Sin seleccionar";
const INTERNAL_ONLY_NOTE = "Información interna: no aparece en la vista pública.";
const NO_SCREENING = "Sin preguntas de filtro.";
const NO_SALARY_AMOUNT = "Compensación por completar";
const SALARY_VISIBLE_STATUS = "Se mostrará en la vista pública";
const SALARY_HIDDEN_STATUS = "No se mostrará en la vista pública";

/** Visible label of one accepted enum value, or `null` when unset/unknown. */
function labelOf(options: DraftOption[], value: string): string | null {
  if (value === "") return null;
  return options.find((option) => option.value === value)?.label ?? null;
}

/** Raw list rows with blank entries dropped for display only. */
function listValues(rows: readonly { value: string }[]): string[] {
  return rows.map((row) => row.value).filter((value) => value.trim() !== "");
}

/**
 * One visible language entry. `valid` is decided by the accepted language
 * schema, so a missing language can never render as a standalone level badge.
 */
type LanguageView = { id: string; text: string; valid: boolean };

/** Visible language entries: valid labels plus honest invalid indications. */
function languageViews(state: DraftFormState): LanguageView[] {
  const views: LanguageView[] = [];
  for (const row of state.languages) {
    const item = {
      language: row.language,
      custom_name:
        row.language === "other" ? (row.customName === "" ? null : row.customName) : null,
      level: row.level === "" ? null : row.level,
    };
    const valid = draftLanguagesSchema.safeParse([item]).success;
    if (valid) {
      const name =
        row.language === "other"
          ? row.customName.trim() === ""
            ? "Otro"
            : row.customName
          : (labelOf(LANGUAGE_OPTIONS, row.language) ?? "");
      const level = labelOf(LANGUAGE_LEVEL_OPTIONS, row.level);
      if (name === "" && level === null) continue;
      views.push({
        id: row.id,
        text: level === null ? name : `${name} · ${level}`,
        valid: true,
      });
      continue;
    }
    if (row.language === "" && row.level === "" && row.customName.trim() === "") continue;
    const level = labelOf(LANGUAGE_LEVEL_OPTIONS, row.level);
    views.push({
      id: row.id,
      text:
        level === null
          ? "Idioma sin definir · revisa este idioma"
          : `Idioma sin definir · nivel ${level} (revisar)`,
      valid: false,
    });
  }
  return views;
}

/** Approved benefit label for one fixed-catalog code, or `null` when unknown. */
function benefitOptionLabel(code: string): string | null {
  if (!(BENEFITS as readonly string[]).includes(code)) return null;
  return benefitLabel(code as (typeof BENEFITS)[number]);
}

/**
 * Contract composition of the raw compensation controls: only the active mode
 * contributes amounts, and inactive buffers stay out. Mirrors the accepted
 * form composition; the schema stays the authority for validity.
 */
function composeCompensation(state: DraftCompensationState) {
  const mode = state.mode === "" ? null : state.mode;
  const money = (raw: string) => (raw === "" ? null : raw);
  return {
    mode,
    amount: mode === "fixed" ? money(state.amount) : null,
    min: mode === "range" ? money(state.min) : null,
    max: mode === "range" ? money(state.max) : null,
    currency: state.currency === "" ? null : state.currency,
    pay_period: state.pay_period === "" ? null : state.pay_period,
    basis: state.basis === "" ? null : state.basis,
    public_visible: state.public_visible,
  };
}

/** Read-only validity of the raw compensation against the accepted schema. */
function isCompensationValid(state: DraftCompensationState): boolean {
  return compensationSchema.safeParse(composeCompensation(state)).success;
}

/** Public compensation state: hidden, invalid/review-required, or exact text. */
type CompensationView =
  | { kind: "hidden" }
  | { kind: "invalid" }
  | { kind: "valid"; amount: string | null; meta: string | null };

/**
 * Hidden compensation never reveals private amounts. Invalid values need
 * review; complete values use the shared public presentation. Draft-only
 * single-bound ranges retain their explicit Desde/Hasta qualifier.
 */
function compensationView(state: DraftCompensationState): CompensationView {
  if (!state.public_visible) return { kind: "hidden" };
  const parsed = compensationSchema.safeParse(composeCompensation(state));
  if (!parsed.success) return { kind: "invalid" };
  const { mode, amount, min, max, currency, pay_period, basis } = parsed.data;
  const meta = [labelOf(PAY_PERIOD_OPTIONS, state.pay_period) ?? "Periodicidad sin definir", labelOf(BASIS_OPTIONS, state.basis) ?? "Neto/bruto sin definir"].join(" · ");
  // Incomplete drafts are valid for saving, but cannot be presented as a
  // complete public salary. Never fill missing currency, cadence or basis.
  if (!currency || !pay_period || !basis || !mode) return { kind: "valid", amount: null, meta };
  const single = mode === "range" && (min === null || max === null);
  const fixed = mode === "fixed" ? amount : single ? min ?? max : null;
  if ((mode === "fixed" || single) && fixed === null) return { kind: "valid", amount: null, meta };
  const parts = previewSalaryParts({ source: "vacancy", compensation: {
    mode: single ? "fixed" : mode, amount: single ? fixed : amount,
    min: single ? null : min, max: single ? null : max, currency, pay_period, basis,
  } });
  const prefix = single ? min === null ? "Hasta " : "Desde " : "";
  return { kind: "valid", amount: parts ? `${prefix}${parts.amount} ${parts.currency}` : null, meta: parts?.cadence ?? meta };
}

/** One labelled data row with its contextual decorative icon. */
function PreviewMetaRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className="break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** One internal group title: a real heading with its decorative icon. */
function PreviewGroupTitle({
  id,
  icon: Icon,
  children,
}: {
  id: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <h5
      id={id}
      className="flex items-center gap-1.5 font-heading text-xs font-medium text-foreground"
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      {children}
    </h5>
  );
}

export type DraftPreviewProps = {
  /** Raw local editor state; read only, never mutated. */
  state: DraftFormState;
  /**
   * Presentation-only override of the internal screening prompts. When the
   * caller edits the local v2 authoring buffer, it supplies the raw (possibly
   * incomplete) prompts here so the review shows them. This is a rendering
   * input only: it is never a serializer input, never normalized and never
   * saved. Absent means the legacy v1 raw rows are shown.
   */
  renderedQuestions?: readonly { id: string; prompt: string }[];
};

export function DraftPreview({ state, renderedQuestions }: DraftPreviewProps) {
  const catalog = useGeoCatalog(state.location.state, state.location.country === "MX");
  const country = catalog.countries.data?.items.find(item => item.id === state.location.country)?.name;
  const region = catalog.states.data?.items.find(item => item.id === state.location.state)?.name;
  const municipality = catalog.municipalities.data?.items.find(item => item.id === state.location.municipality)?.name;
  const locationLabel = state.locationLabel ?? (municipality && region ? `${municipality}, ${region}` : region ?? country ?? "");
  const remoteLabel = state.remote_scope?.kind === "anywhere" ? "Remoto · Desde cualquier lugar" : state.remote_scope?.kind === "countries" && state.remoteCountries.length ? `Remoto · Solo desde ${state.remoteCountries.map(country => country.name).join(", ")}` : "Remoto";
  const description = resolveDraftRichDescription(state.description);
  const skills = listValues(state.skills);
  const customBenefits = listValues(state.custom_benefits);
  const screening =
    renderedQuestions === undefined
      ? listValues(state.screening_questions)
      : renderedQuestions
          .map((question) => question.prompt)
          .filter((prompt) => prompt.trim() !== "");
  const languages = languageViews(state);
  const benefitLabels = [
    ...state.benefits
      .map(benefitOptionLabel)
      .filter((value): value is string => value !== null),
    ...customBenefits,
  ];
  const compensation = compensationView(state.compensation);
  const requesterKind = labelOf(REQUESTER_KIND_OPTIONS, state.requester.kind);
  const requesterValue = state.requester.name ?? NO_SELECTION;

  const basics = [
    { key: "location", label: "Ubicación", Icon: MapPinIcon, value: locationLabel },
    {
      key: "work_mode",
      label: "Modalidad",
      Icon: GlobeIcon,
      value: state.work_mode === "remote" ? remoteLabel : labelOf(WORK_MODE_OPTIONS, state.work_mode) ?? "",
    },
    {
      key: "work_schedule",
      label: "Jornada",
      Icon: ClockIcon,
      value: labelOf(WORK_SCHEDULE_OPTIONS, state.work_schedule) ?? "",
    },
    {
      key: "contract_type",
      label: "Tipo de contrato",
      Icon: FileTextIcon,
      value: labelOf(CONTRACT_TYPE_OPTIONS, state.contract_type) ?? "",
    },
    {
      key: "seniority",
      label: "Nivel",
      Icon: TrendingUpIcon,
      value: labelOf(SENIORITY_OPTIONS, state.seniority) ?? "",
    },
    {
      key: "professional_area",
      label: "Área profesional",
      Icon: LayoutGridIcon,
      value: labelOf(PROFESSIONAL_AREA_OPTIONS, state.professional_area) ?? "",
    },
  ].filter((row) => row.value.trim() !== "");

  return (
    <div className="flex flex-col gap-6" data-pf-draft-preview="">
      <Card aria-labelledby="draft-preview-public-heading" data-pf-draft-public="">
        <CardHeader>
          <CardTitle><h4 id="draft-preview-public-heading" className="flex items-center gap-2 font-heading text-sm font-semibold">
            <EyeIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            Vista previa pública
          </h4></CardTitle>
          <CardDescription>Así se verá tu vacante cuando se publique. El solicitante no aparece aquí.</CardDescription>
          <CardAction><Badge variant="secondary">Borrador</Badge></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
        <p
          className={cn(
            "font-heading text-lg font-semibold break-words",
            state.title.trim() === "" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {state.title.trim() === "" ? NOT_DEFINED_TITLE : state.title}
        </p>

        {basics.length > 0 && (
          <dl className="grid gap-3 sm:grid-cols-2">
            {basics.map(({ key, label, Icon, value }) => (
              <PreviewMetaRow key={key} icon={Icon} label={label}>
                {value}
              </PreviewMetaRow>
            ))}
          </dl>
        )}

        <div className="flex flex-col gap-2">
          <PreviewGroupTitle id="draft-preview-compensation" icon={BanknoteIcon}>Compensación</PreviewGroupTitle>
          {compensation.kind === "hidden" ? <p className="text-sm text-muted-foreground">Salario no publicado</p>
            : compensation.kind === "invalid" ? <>
              <Badge variant="danger">Revisar compensación</Badge>
              <p className="text-sm text-muted-foreground">La compensación capturada no es válida; corrígela antes de publicar.</p>
            </> : <>
              <p className="font-heading text-2xl font-semibold tabular-nums text-foreground">{compensation.amount ?? NO_SALARY_AMOUNT}</p>
              {compensation.meta && <p className="text-sm text-muted-foreground">{compensation.meta}</p>}
            </>}
        </div>

        <div className="flex flex-col gap-2">
          <PreviewGroupTitle id="draft-preview-description" icon={FileTextIcon}>
            Descripción
          </PreviewGroupTitle>
          {description.kind === "invalid" ? (
            <p className="text-sm text-muted-foreground">{DESCRIPTION_UNAVAILABLE}</p>
          ) : description.kind === "empty" ? (
            <p className="text-sm text-muted-foreground">{NO_DESCRIPTION}</p>
          ) : (
            <DraftRichDescriptionContent description={description.description} />
          )}
        </div>

        {(state.required_requirements.trim() !== "" ||
          state.preferred_requirements.trim() !== "") && (
          <div className="flex flex-col gap-2">
            <PreviewGroupTitle id="draft-preview-requirements" icon={ListChecksIcon}>
              Requisitos
            </PreviewGroupTitle>
            <dl className="flex flex-col gap-2 text-sm">
              {state.required_requirements.trim() === "" ? null : (
                <div className="flex flex-col gap-1">
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    Obligatorios
                  </dt>
                  <dd className="break-words whitespace-pre-line">
                    {state.required_requirements}
                  </dd>
                </div>
              )}
              {state.preferred_requirements.trim() === "" ? null : (
                <div className="flex flex-col gap-1">
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <SparklesIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    Deseables
                  </dt>
                  <dd className="break-words whitespace-pre-line">
                    {state.preferred_requirements}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {skills.length > 0 && (
          <div className="flex flex-col gap-2">
            <PreviewGroupTitle id="draft-preview-skills" icon={WrenchIcon}>
              Habilidades
            </PreviewGroupTitle>
            <ul className="flex flex-wrap gap-2">
              {skills.map((skill, index) => (
                <li key={`${skill}-${index}`}>
                  <Badge variant="secondary" className="h-auto max-w-full whitespace-normal break-words">
                    {skill}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {languages.length > 0 && (
          <div className="flex flex-col gap-2">
            <PreviewGroupTitle id="draft-preview-languages" icon={LanguagesIcon}>
              Idiomas
            </PreviewGroupTitle>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              {languages.map((language) => <li key={language.id} className="break-words">{language.text}</li>)}
            </ul>
          </div>
        )}

        {benefitLabels.length > 0 && (
          <div className="flex flex-col gap-2">
            <PreviewGroupTitle id="draft-preview-benefits" icon={GiftIcon}>
              Prestaciones
            </PreviewGroupTitle>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              {benefitLabels.map((benefit, index) => <li key={`${benefit}-${index}`} className="break-words">{benefit}</li>)}
            </ul>
          </div>
        )}

        </CardContent>
      </Card>

      <section
        aria-labelledby="draft-preview-internal-heading"
        data-pf-draft-internal=""
        className="flex flex-col gap-4 border-t border-border pt-6"
      >
        <div className="flex items-center gap-2">
          <LockIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <h4
            id="draft-preview-internal-heading"
            className="font-heading text-sm font-semibold text-foreground"
          >
            Revisión interna
          </h4>
        </div>
        <p className="text-xs text-muted-foreground">{INTERNAL_ONLY_NOTE}</p>

        <div className="flex flex-col gap-2">
          <PreviewGroupTitle id="draft-preview-requester" icon={UserRoundIcon}>
            Solicitante
          </PreviewGroupTitle>
          <p className="text-sm text-foreground">
            {requesterKind === null ? NO_SELECTION : requesterKind}
          </p>
          <p className="break-words text-sm text-muted-foreground">{requesterValue}</p>
        </div>

        <div className="flex flex-col gap-2">
          <PreviewGroupTitle id="draft-preview-screening" icon={CircleHelpIcon}>
            Preguntas para filtrar
          </PreviewGroupTitle>
          {screening.length === 0 ? (
            <p className="text-sm text-muted-foreground">{NO_SCREENING}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm text-foreground">
              {screening.map((prompt, index) => (
                <li key={`${prompt}-${index}`} className="break-words">
                  {prompt}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <PreviewGroupTitle id="draft-preview-visibility" icon={BanknoteIcon}>
            Compensación
          </PreviewGroupTitle>
          <div className="flex flex-wrap gap-2">
            <p className="text-sm text-muted-foreground">
              {state.compensation.public_visible ? SALARY_VISIBLE_STATUS : SALARY_HIDDEN_STATUS}
            </p>
            {isCompensationValid(state.compensation) ? null : (
              <Badge variant="danger">Revisar compensación</Badge>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
