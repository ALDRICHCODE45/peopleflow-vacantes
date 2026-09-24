import { Building2Icon, EyeIcon } from "lucide-react";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  employmentTypeLabel,
  formatSalary,
  seniorityLabel,
  workModeLabel,
} from "../formatters";
import type {
  EmploymentType,
  SalaryCurrency,
  Seniority,
  WorkMode,
} from "../formatters";
import { PrototypeDossier, toPlainSummary } from "./form/prototype-dossier";
import type { VacancyPrototypeValues } from "./form/prototype-model";

/**
 * Current draft state of the contract-backed create-vacancy form.
 *
 * Enum entries stay empty strings until the employer picks a value, and the
 * salary entries stay raw DOM strings so the preview can react to typing
 * without pretending an unparsed value already is a contract value.
 */
export type VacancyPreviewValues = {
  title: string;
  description: string;
  location: string;
  workMode: WorkMode | "";
  employmentType: EmploymentType | "";
  seniority: Seniority | "";
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: SalaryCurrency;
};

type PreviewChip = { key: string; label: string; placeholder: boolean };

/**
 * Reads a salary bound the contract can actually accept: a non-negative safe
 * integer. Anything else (blank, thousands separators, decimals, letters) is
 * treated as "no value" instead of being rounded or guessed.
 */
function toSalaryAmount(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Draft-only public card preview.
 *
 * Presentational by design: it derives everything from the current form values
 * (the exact `POST /jobs` fields) and owns no control, no request, and no
 * publication claim. When the caller supplies the local-only prototype values it
 * composes the focused exploratory dossier below the card; autosave, private
 * visibility, and publishing still do not exist here, and nothing in the dossier
 * is presented as persisted.
 */
export function VacancyPreview({
  title,
  description,
  location,
  workMode,
  employmentType,
  seniority,
  salaryMin,
  salaryMax,
  salaryCurrency,
  prototype,
}: VacancyPreviewValues & { prototype?: VacancyPrototypeValues }) {
  const trimmedTitle = title.trim();
  const trimmedLocation = location.trim();
  const trimmedDescription = description.trim();
  const min = toSalaryAmount(salaryMin);
  const max = toSalaryAmount(salaryMax);
  // Two contract-valid bounds can still describe a reversed range. The public
  // surface never shows it: the shared formatter is reused only for an order it
  // can state honestly.
  const reversed = min !== undefined && max !== undefined && min > max;
  const salary = reversed
    ? null
    : formatSalary({ min, max, currency: salaryCurrency });

  // Each unselected enum keeps its slot with an explicit placeholder, so the
  // card never renders an empty row or an invented value.
  const chips: PreviewChip[] = [
    workMode === ""
      ? { key: "workMode", label: "Modalidad sin definir", placeholder: true }
      : { key: "workMode", label: workModeLabel(workMode), placeholder: false },
    employmentType === ""
      ? { key: "employmentType", label: "Jornada sin definir", placeholder: true }
      : {
          key: "employmentType",
          label: employmentTypeLabel(employmentType),
          placeholder: false,
        },
    seniority === ""
      ? { key: "seniority", label: "Seniority sin definir", placeholder: true }
      : { key: "seniority", label: seniorityLabel(seniority), placeholder: false },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <EyeIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2 className="font-heading text-sm font-medium">
            Vista previa pública
          </h2>
          <Badge variant="secondary">Borrador</Badge>
        </CardTitle>
        <CardDescription>
          Así se verá tu vacante cuando esté publicada.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="rounded-2xl border border-border bg-background/60 p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
            >
              <Building2Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm leading-tight font-semibold break-words",
                  trimmedTitle === ""
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              >
                {trimmedTitle === "" ? "Título del puesto" : trimmedTitle}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {`Tu empresa${trimmedLocation === "" ? "" : ` · ${trimmedLocation}`}`}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Badge
                key={chip.key}
                variant={chip.placeholder ? "outline" : "secondary"}
                className={chip.placeholder ? "text-muted-foreground" : undefined}
              >
                {chip.label}
              </Badge>
            ))}
          </div>

          <p
            className={cn(
              "mt-3 line-clamp-3 text-xs leading-relaxed whitespace-pre-line text-muted-foreground",
              trimmedDescription === "" && "italic",
            )}
          >
            {trimmedDescription === ""
              ? "Todavía no escribiste una descripción."
              : toPlainSummary(trimmedDescription)}
          </p>

          <div className="mt-3 border-t border-border/60 pt-2.5 text-xs">
            <span
              className={cn(
                salary === null
                  ? "text-muted-foreground"
                  : "font-semibold text-foreground",
              )}
            >
              {salary ?? "Salario a convenir"}
            </span>
          </div>
        </div>

        <PrototypeDossier prototype={prototype} />

        <p className="text-xs leading-relaxed text-muted-foreground">
          Vista previa de borrador: esta vacante todavía no está publicada.
        </p>
      </CardContent>
    </Card>
  );
}
