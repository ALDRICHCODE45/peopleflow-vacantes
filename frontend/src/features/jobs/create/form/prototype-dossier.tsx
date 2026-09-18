import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "cn";

import { toPlainText } from "./rich-text-model";
import { BENEFIT_OPTIONS, PAY_FREQUENCY_OPTIONS } from "./prototype-model";
import type { VacancyPrototypeValues } from "./prototype-model";

/**
 * Exploratory dossier of the draft preview.
 *
 * Everything here is prototype-only presentation: the formatters, the catalog
 * lookups, the badge clamp, and the dossier itself. It reads the local-only
 * prototype model and renders ordinary elements, so it owns no request, no save,
 * and no claim that any of these values is stored or published. The module never
 * imports the preview or the rail, so the dependency stays one-way.
 */

/** How many technology badges the dossier shows before it counts the rest. */
const MAX_VISIBLE_SKILLS = 6;

type ExploratoryRow = { label: string; value: string; clamp?: boolean };

/** Spanish label of the exploratory pay frequency, or null when unset. */
export function payFrequencyLabel(
  value: VacancyPrototypeValues["payFrequency"],
): string | null {
  return PAY_FREQUENCY_OPTIONS.find((option) => option.value === value)?.label ?? null;
}

/**
 * Thin public-summary projection over the shared plain-text normalizer: every
 * line break and run of whitespace collapses to one space, so a formatted value
 * reads as one honest sentence. The baseline description and the exploratory
 * summaries share this one path.
 */
export function toPlainSummary(value: string): string {
  return toPlainText(value).replace(/\s+/gu, " ").trim();
}

/** Formats a date-input value in Spanish without any time-zone shift. */
function formatClosingDate(value: string): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim());
  if (parts === null) return null;

  const date = new Date(
    Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])),
  );
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Languages with their CEFR band, in the order the recruiter wrote them. */
function languageSummary(languages: VacancyPrototypeValues["languages"]): string {
  return languages
    .filter((language) => language.language.trim() !== "")
    .map((language) =>
      language.level === ""
        ? language.language.trim()
        : `${language.language.trim()} · ${language.level}`,
    )
    .join(" · ");
}

/** Selected benefit labels in catalog order. */
function benefitSummary(benefits: VacancyPrototypeValues["benefits"]): string {
  return BENEFIT_OPTIONS.filter((option) => benefits.includes(option.value))
    .map((option) => option.label)
    .join(" · ");
}

/** The exploratory rows, in the order the dossier presents them. */
function exploratoryRows(prototype: VacancyPrototypeValues): ExploratoryRow[] {
  const rows: ExploratoryRow[] = [];
  const department = prototype.department.trim();
  if (department !== "") rows.push({ label: "Área", value: department });

  const frequency = payFrequencyLabel(prototype.payFrequency);
  if (frequency !== null) {
    rows.push({ label: "Frecuencia de pago", value: frequency });
  }

  const languages = languageSummary(prototype.languages);
  if (languages !== "") rows.push({ label: "Idiomas", value: languages });

  const benefits = benefitSummary(prototype.benefits);
  if (benefits !== "") {
    rows.push({ label: `Beneficios (${prototype.benefits.length})`, value: benefits });
  }

  const closingDate = formatClosingDate(prototype.closingDate);
  if (closingDate !== null) {
    rows.push({ label: "Cierre de postulaciones", value: closingDate });
  }

  const required = toPlainSummary(prototype.requiredRequirements);
  if (required !== "") {
    rows.push({ label: "Requisitos obligatorios", value: required, clamp: true });
  }

  const preferred = toPlainSummary(prototype.preferredRequirements);
  if (preferred !== "") {
    rows.push({ label: "Requisitos deseables", value: preferred, clamp: true });
  }

  const questions = prototype.screeningQuestions.length;
  rows.push({
    label: "Preguntas de filtro",
    value:
      questions === 0 ? "Sin preguntas" : `${questions} pregunta${questions === 1 ? "" : "s"}`,
  });

  return rows;
}

/** True as soon as any exploratory field carries content worth showing. */
function hasExploratoryContent(prototype: VacancyPrototypeValues): boolean {
  return (
    prototype.department.trim() !== "" ||
    prototype.skills.length > 0 ||
    languageSummary(prototype.languages) !== "" ||
    prototype.benefits.length > 0 ||
    prototype.requiredRequirements.trim() !== "" ||
    prototype.preferredRequirements.trim() !== "" ||
    prototype.screeningQuestions.length > 0 ||
    payFrequencyLabel(prototype.payFrequency) !== null ||
    formatClosingDate(prototype.closingDate) !== null
  );
}

export type PrototypeDossierProps = {
  /** Local-only exploratory state; nothing renders while it is empty. */
  prototype?: VacancyPrototypeValues;
};

/**
 * Restrained exploratory block: a labelled header, the clamped technology
 * badges, one row per exploratory category, and an explicit note that none of it
 * is stored or published. It renders nothing when there is nothing to show, so
 * the rail never carries an empty box.
 */
export function PrototypeDossier({ prototype }: PrototypeDossierProps) {
  if (prototype === undefined || !hasExploratoryContent(prototype)) return null;

  const visibleSkills = prototype.skills.slice(0, MAX_VISIBLE_SKILLS);
  const hiddenSkills = prototype.skills.length - visibleSkills.length;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-xs font-medium">Detalles exploratorios</h3>
        <Badge variant="outline" className="text-muted-foreground">
          Prototipo
        </Badge>
      </div>

      {visibleSkills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Tecnologías
          </span>
          {visibleSkills.map((skill) => (
            <Badge key={skill} variant="secondary">
              {skill}
            </Badge>
          ))}
          {hiddenSkills > 0 && <Badge variant="outline">{`+${hiddenSkills}`}</Badge>}
        </div>
      )}

      <Separator className="bg-border/60" />

      <dl className="flex flex-col gap-1.5 text-xs">
        {exploratoryRows(prototype).map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <dt className="font-medium text-muted-foreground">{row.label}</dt>
            <dd className={cn("leading-relaxed", row.clamp === true && "line-clamp-2")}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Detalles de prototipo: todavía no se guardan ni se publican.
      </p>
    </div>
  );
}
