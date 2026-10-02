"use client";

import * as React from "react";
import { FilterIcon, RotateCcwIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox";
import { DatePickerField } from "@/components/ui/date-picker-field";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { PipelineCandidate } from "./pipeline-model";
import {
  PIPELINE_EXPERIENCE_BUCKETS,
  applyExperienceBucket,
  createEmptyPipelineFilters,
  describePipelineFilters,
  experienceBucketValue,
  hasActivePipelineFilters,
  isReceivedRangeReversed,
  pipelineSkillOptions,
  pipelineSourceOptions,
  pipelineStatusOptions,
  removePipelineFilter,
  type PipelineExperienceBucketValue,
  type PipelineFilters,
} from "./pipeline-filter-model";

/**
 * Filter surface of one vacancy pipeline, matching the talent-base language: the
 * toolbar keeps the removable active-filter chips and the count; the full
 * criteria live in one floating lateral Sheet so the board never carries an
 * inline grid of controls. Every control mutates one in-memory filter object
 * through the pure model: no request, storage or fake success. Values OR inside
 * a facet and AND across facets plus the search, and the received-date range is
 * inclusive on the supplied local civil day.
 */

type Option = { readonly value: string; readonly label: string };

/** Searchable multi-select of one facet, rendered as shadcn combobox chips. */
function FacetMultiSelect({
  facet,
  legend,
  options,
  selected,
  onChange,
}: {
  facet: string;
  legend: string;
  options: readonly Option[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const labelById = React.useMemo(
    () => new Map<string, string>(options.map((option) => [option.value, option.label])),
    [options],
  );
  // Base UI compares an item against the selected value with `Object.is` and
  // resolves the selected index from the `items` list. Passing the option
  // objects as `items` while the controlled value and every `ComboboxItem`
  // carried domain ids made that lookup compare an object against a string and
  // always miss, so the reopened popup never anchored on its selection. The
  // list now receives the primitive domain ids and `itemToStringLabel` supplies
  // each Spanish label for filtering, typeahead and the visible option text.
  const itemValues = React.useMemo(() => options.map((option) => option.value), [options]);
  const inputId = `pipeline-filtro-${facet}`;

  return (
    <FieldSet data-pf-pipeline-facet={facet} className="gap-2">
      <FieldLegend variant="label" className="mb-0">
        {legend}
      </FieldLegend>
      <Combobox
        multiple
        items={itemValues}
        value={[...selected]}
        onValueChange={onChange}
        itemToStringLabel={(value: string) => labelById.get(value) ?? value}
      >
        <ComboboxChips>
          <ComboboxValue>
            {(value: string[]) => (
              <>
                {value.map((item) => (
                  <ComboboxChip key={item}>{labelById.get(item) ?? item}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  id={inputId}
                  aria-label={legend}
                  placeholder={`Buscar ${legend.toLowerCase()}`}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent>
          <ComboboxEmpty>Sin resultados</ComboboxEmpty>
          {/* The installed Base UI items API owns filtering: the root receives
              the full primitive id list and the list renders the filtered slice,
              so a typed query narrows the options and `ComboboxEmpty` only shows
              when nothing matches. `itemToStringLabel` maps each domain id to
              its Spanish label, which is both what the query is matched against
              and what the option displays. */}
          <ComboboxList>
            {(value: string) => (
              <ComboboxItem
                key={value}
                value={value}
                data-pf-pipeline-option={`${facet}:${value}`}
              >
                {labelById.get(value) ?? value}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </FieldSet>
  );
}

export type PipelineFilterBarProps = {
  /** The unfiltered vacancy-scoped candidates every option is derived from. */
  candidates: readonly PipelineCandidate[];
  filters: PipelineFilters;
  onChange: (next: PipelineFilters) => void;
};

export function PipelineFilterBar({ candidates, filters, onChange }: PipelineFilterBarProps) {
  const [open, setOpen] = React.useState(false);
  const chips = describePipelineFilters(filters);
  const activeCount = chips.length;
  const hasActive = hasActivePipelineFilters(filters);
  const bucket = experienceBucketValue(filters);
  const reversedRange = isReceivedRangeReversed(filters);

  // Options always read the unfiltered vacancy-scoped input, so filtering the
  // visible set never removes an option from the Sheet.
  const statusOptions = React.useMemo(() => pipelineStatusOptions(candidates), [candidates]);
  const sourceOptions = React.useMemo(() => pipelineSourceOptions(candidates), [candidates]);
  const skillOptions = React.useMemo(() => pipelineSkillOptions(candidates), [candidates]);

  return (
    <section
      data-pf-pipeline-filters-region=""
      aria-label="Filtros del pipeline"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button type="button" variant="outline" data-pf-pipeline-filter-toggle="">
                <FilterIcon data-icon="inline-start" aria-hidden="true" />
                Filtros
                {hasActive ? (
                  <Badge variant="secondary" data-pf-pipeline-filter-count="">
                    {activeCount}
                  </Badge>
                ) : null}
              </Button>
            }
          />
          <SheetContent
            side="right"
            showCloseButton={false}
            data-pf-pipeline-filters=""
            className="w-full gap-0 sm:max-w-md"
          >
            <SheetHeader className="border-b border-border">
              <SheetTitle>Filtros</SheetTitle>
              <SheetDescription>
                Combina etapa, origen, habilidades, experiencia y fecha de recepción.
                Se aplican al instante sobre el pipeline.
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
              <FieldGroup className="gap-5">
                <FacetMultiSelect
                  facet="status"
                  legend="Etapa"
                  options={statusOptions}
                  selected={filters.statuses}
                  onChange={(next) =>
                    onChange({ ...filters, statuses: next as PipelineFilters["statuses"] })
                  }
                />
                <FacetMultiSelect
                  facet="source"
                  legend="Origen"
                  options={sourceOptions}
                  selected={filters.sources}
                  onChange={(next) =>
                    onChange({ ...filters, sources: next as PipelineFilters["sources"] })
                  }
                />
                <FacetMultiSelect
                  facet="skill"
                  legend="Habilidades"
                  options={skillOptions}
                  selected={filters.skills}
                  onChange={(next) => onChange({ ...filters, skills: next })}
                />

                <FieldSet data-pf-pipeline-facet="experience" className="gap-2">
                  <FieldLegend variant="label" className="mb-0">
                    Experiencia
                  </FieldLegend>
                  <ToggleGroup
                    aria-label="Experiencia"
                    value={bucket ? [bucket] : []}
                    onValueChange={(values: string[]) =>
                      onChange(
                        applyExperienceBucket(
                          filters,
                          (values[0] as PipelineExperienceBucketValue | undefined) ?? undefined,
                        ),
                      )
                    }
                    className="flex-wrap"
                  >
                    {PIPELINE_EXPERIENCE_BUCKETS.map((option) => (
                      <ToggleGroupItem
                        key={option.value}
                        value={option.value}
                        size="sm"
                        data-pf-pipeline-option={`experience:${option.value}`}
                      >
                        {option.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </FieldSet>

                <FieldSet data-pf-pipeline-facet="received" className="gap-2">
                  <FieldLegend variant="label" className="mb-0">
                    Fecha de recepción
                  </FieldLegend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel id="pipeline-recibidos-desde-label" htmlFor="pipeline-recibidos-desde">
                        Recibidos desde
                      </FieldLabel>
                      <div data-pf-pipeline-received-from="">
                        <DatePickerField
                          id="pipeline-recibidos-desde"
                          value={filters.receivedFrom ?? ""}
                          onChange={(next) =>
                            onChange({ ...filters, receivedFrom: next || undefined })
                          }
                          aria-labelledby="pipeline-recibidos-desde-label"
                          allowPast
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel id="pipeline-recibidos-hasta-label" htmlFor="pipeline-recibidos-hasta">
                        Recibidos hasta
                      </FieldLabel>
                      <div data-pf-pipeline-received-to="">
                        <DatePickerField
                          id="pipeline-recibidos-hasta"
                          value={filters.receivedTo ?? ""}
                          onChange={(next) =>
                            onChange({ ...filters, receivedTo: next || undefined })
                          }
                          aria-labelledby="pipeline-recibidos-hasta-label"
                          allowPast
                        />
                      </div>
                    </Field>
                  </div>
                  <FieldDescription>
                    Filtra por el día en que se recibió cada postulación.
                  </FieldDescription>
                  {reversedRange ? (
                    <FieldDescription data-pf-pipeline-range-error="" className="text-destructive">
                      La fecha inicial es posterior a la final; el rango no devolverá resultados.
                    </FieldDescription>
                  ) : null}
                </FieldSet>
              </FieldGroup>
            </div>

            <SheetFooter className="flex-row gap-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                data-pf-pipeline-filters-reset=""
                className="flex-1"
                disabled={!hasActive}
                onClick={() => onChange(createEmptyPipelineFilters())}
              >
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                Limpiar filtros
              </Button>
              <SheetClose
                render={<Button type="button" data-pf-pipeline-filters-close="" className="flex-1" />}
              >
                Ver resultados
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {hasActive ? (
        <div data-pf-pipeline-chips="" className="flex flex-wrap items-center gap-2">
          {chips.map((item) => (
            <Button
              key={item.key}
              type="button"
              variant="outline"
              size="sm"
              data-pf-pipeline-chip={item.key}
              onClick={() => onChange(removePipelineFilter(filters, item.key))}
            >
              {item.label}
              <XIcon data-icon="inline-end" aria-hidden="true" />
              <span className="sr-only">Quitar filtro</span>
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
