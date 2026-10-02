import { PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  employmentTypeLabel,
  formatClosingDate,
  formatSalary,
  seniorityLabel,
  workModeLabel,
} from "../../formatters";
import { DraftRail } from "./draft-rail";
import { normalizeSalaryInput } from "./model";
import type { VacancyFormValues } from "./model";
import {
  benefitSummary,
  languageSummary,
  payFrequencyLabel,
  toPlainSummary,
} from "./prototype-dossier";
import { MAX_SCREENING_QUESTIONS } from "./prototype-model";
import type {
  ScreeningQuestion,
  VacancyPrototypeValues,
} from "./prototype-model";
import { stepTitle } from "./step-model";
import type { VacancyStepId } from "./step-model";

/**
 * Review surface of the wizard: a derived, grouped summary of everything the
 * recruiter entered, one edit action per group that returns to its step, and the
 * preview-plus-save rail that exists only here.
 *
 * Every row is derived from the current state on render: no hook, no effect, no
 * memo, and no claim about validity or saving. The only contract authority is
 * the wizard owner, so the review never re-decides what the schema accepts.
 */

/** Steps that own editable content; review itself never appears as a group. */
export type ReviewStepId = Exclude<VacancyStepId, "review">;

export type ReviewRow = {
  label: string;
  value: string;
  /** True when the row shows a placeholder instead of entered content. */
  empty: boolean;
  /**
   * Ordered detail values shown under the summary value. Used to audit short
   * lists, like the screening prompts, without collapsing them into a count.
   */
  items?: readonly string[];
};

export type ReviewGroup = {
  id: ReviewStepId;
  title: string;
  rows: readonly ReviewRow[];
};

const UNSPECIFIED = "Sin especificar";

const row = (label: string, value: string): ReviewRow => ({
  label,
  value: value.trim() === "" ? UNSPECIFIED : value.trim(),
  empty: value.trim() === "",
});

/** A row whose display text is already a label, with its own placeholder. */
const labelRow = (label: string, display: string): ReviewRow => ({
  label,
  value: display,
  empty: display === UNSPECIFIED,
});

/**
 * The screening questions, keeping the count and every prompt in written order.
 * A blank prompt stays visible as an explicit placeholder, so the number of
 * rows always matches the announced count and nothing is silently dropped.
 */
function screeningQuestionsRow(
  questions: readonly ScreeningQuestion[],
): ReviewRow {
  if (questions.length === 0) {
    return { label: "Preguntas de filtro", value: "Sin preguntas", empty: true };
  }
  return {
    label: "Preguntas de filtro",
    value: `${questions.length} de ${MAX_SCREENING_QUESTIONS}`,
    empty: false,
    items: questions.map((question) => question.prompt.trim() || UNSPECIFIED),
  };
}

/** Reuses the contract normalizer so a display never invents a different bound. */
function salaryAmount(value: string): number | undefined {
  const normalized = normalizeSalaryInput(value);
  return typeof normalized === "number" ? normalized : undefined;
}

/** The salary summary, or the raw bounds when the range is reversed. */
function salarySummary(values: VacancyFormValues): ReviewRow {
  const min = salaryAmount(values.salaryMin);
  const max = salaryAmount(values.salaryMax);
  const reversed = min !== undefined && max !== undefined && min > max;
  if (reversed) {
    const raw = `${values.salaryMin.trim()} – ${values.salaryMax.trim()} ${values.salaryCurrency}`;
    return { label: "Salario", value: raw, empty: false };
  }
  const formatted = formatSalary({ min, max, currency: values.salaryCurrency });
  return {
    label: "Salario",
    value: formatted ?? UNSPECIFIED,
    empty: formatted === null,
  };
}

/** One deterministic Spanish label per chosen contract enum, or a placeholder. */
function enumRow<T extends string>(
  label: string,
  value: T | "",
  display: (value: T) => string,
): ReviewRow {
  if (value === "") return { label, value: UNSPECIFIED, empty: true };
  return { label, value: display(value), empty: false };
}

/** Every editable group, in wizard order, derived from the current state. */
export function reviewGroups(
  values: VacancyFormValues,
  prototype: VacancyPrototypeValues,
): readonly ReviewGroup[] {
  return [
    {
      id: "basic-information",
      title: stepTitle("basic-information"),
      rows: [
        row("Título del puesto", values.title),
        row("Área o departamento", prototype.department),
        row("Ubicación", values.location),
        enumRow("Modalidad", values.workMode, workModeLabel),
        enumRow("Jornada", values.employmentType, employmentTypeLabel),
        enumRow("Seniority", values.seniority, seniorityLabel),
      ],
    },
    {
      id: "role-profile",
      title: stepTitle("role-profile"),
      rows: [
        row("Descripción", toPlainSummary(values.description)),
        row("Requisitos obligatorios", toPlainSummary(prototype.requiredRequirements)),
        row("Requisitos deseables", toPlainSummary(prototype.preferredRequirements)),
        row("Habilidades y tecnologías", prototype.skills.join(" · ")),
        row("Idiomas", languageSummary(prototype.languages)),
      ],
    },
    {
      id: "conditions-process",
      title: stepTitle("conditions-process"),
      rows: [
        salarySummary(values),
        labelRow("Moneda", values.salaryCurrency),
        labelRow(
          "Frecuencia de pago",
          payFrequencyLabel(prototype.payFrequency) ?? UNSPECIFIED,
        ),
        row("Beneficios", benefitSummary(prototype.benefits)),
        row(
          "Cierre de postulaciones",
          prototype.closingDate.trim() === ""
            ? ""
            : formatClosingDate(prototype.closingDate),
        ),
        screeningQuestionsRow(prototype.screeningQuestions),
      ],
    },
  ];
}

export type ReviewStepProps = {
  values: VacancyFormValues;
  prototypeValues: VacancyPrototypeValues;
  /** Returns to the group's step so the recruiter can edit it. */
  onEditStep: (step: ReviewStepId) => void;
};

/**
 * One card per editable group, each with a single edit action, plus the
 * preview-and-save rail. The single action per card keeps the summary honest and
 * the footer free of a button tray.
 */
export function ReviewStep({
  values,
  prototypeValues,
  onEditStep,
}: ReviewStepProps) {
  const groups = reviewGroups(values, prototypeValues);

  return (
    <div
      data-pf-review-step=""
      className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]"
    >
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2
            id="vacancy-step-heading"
            tabIndex={-1}
            className="font-heading text-lg font-semibold"
          >
            {stepTitle("review")}
          </h2>
          <p className="text-sm text-muted-foreground">
            Revisa el contenido de cada paso antes de guardar el borrador.
          </p>
        </div>

        {groups.map((group) => (
          <Card key={group.id} size="sm" data-pf-review-group={group.id}>
            <CardHeader>
              <CardTitle>
                <h3 className="font-heading text-base font-medium">
                  {group.title}
                </h3>
              </CardTitle>
              <div data-slot="card-action" className="self-start">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() => onEditStep(group.id)}
                  aria-label={`Editar ${group.title.toLowerCase()}`}
                >
                  <PencilIcon data-icon="inline-start" />
                  Editar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2.5">
                {group.rows.map((item) => {
                  const items = item.items ?? [];
                  return (
                    <div
                      key={item.label}
                      className={
                        items.length > 0
                          ? "flex flex-col gap-1"
                          : "flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                      }
                    >
                      <dt className="text-xs text-muted-foreground">
                        {item.label}
                      </dt>
                      <dd
                        className={
                          item.empty
                            ? "text-sm text-muted-foreground"
                            : "text-sm text-foreground"
                        }
                      >
                        <span>{item.value}</span>
                        {items.length > 0 && (
                          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                            {items.map((text, index) => (
                              <li
                                key={`${item.label}-${index}`}
                                className="leading-relaxed break-words"
                              >
                                {text}
                              </li>
                            ))}
                          </ul>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      <DraftRail values={values} prototypeValues={prototypeValues} />
    </div>
  );
}
