"use client";

import * as React from "react";
import { IconFilter, IconRotate, IconSearch, IconX } from "@tabler/icons-react";

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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
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
import {
  TALENT_AVAILABILITIES,
  TALENT_AVAILABILITY_LABELS,
  TALENT_EMPLOYER_VACANCY_IDS,
  TALENT_EXPERIENCE_BUCKETS,
  TALENT_INDUSTRIES,
  TALENT_LOCATIONS,
  TALENT_MODALITIES,
  TALENT_MODALITY_LABELS,
  TALENT_SKILLS,
  TALENT_SOURCES,
  TALENT_SOURCE_LABELS,
  TALENT_STAGES,
  TALENT_STAGE_LABELS,
  applyExperienceBucket,
  createEmptyTalentFilters,
  describeTalentFilters,
  experienceBucketValue,
  removeTalentFilter,
  type TalentExperienceBucketValue,
  type TalentFilters,
} from "./model";

/**
 * Filter surface of the talent base. The toolbar keeps the live search and the
 * removable active-filter chips; the full criteria live in one lateral Sheet
 * so the table never carries a huge inline grid of checkboxes. Every control
 * mutates one in-memory filter object through the pure model: no request,
 * storage or fake success. Values OR inside a facet and AND across facets, and
 * application criteria are matched against a single application at once.
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
  const inputId = `talento-filtro-${facet}`;

  return (
    <FieldSet data-pf-talento-facet={facet} className="gap-2">
      <FieldLegend variant="label" className="mb-0">
        {legend}
      </FieldLegend>
      <Combobox
        multiple
        items={options}
        value={[...selected]}
        onValueChange={onChange}
      >
        <ComboboxChips>
          <ComboboxValue>
            {(value: string[]) => (
              <>
                {value.map((item) => (
                  <ComboboxChip key={item}>
                    {labelById.get(item) ?? item}
                  </ComboboxChip>
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
          {/* The installed Base UI 1.7 items API owns filtering: the root receives
              the full `items` list and the list renders the filtered slice, so a
              typed query narrows the options and `ComboboxEmpty` only shows when
              nothing matches. Mapping the raw `options` here would bypass the
              filter and always render every option. Domain ids stay as values
              and their labels stay as the visible, filterable text. */}
          <ComboboxList>
            {(item: Option) => (
              <ComboboxItem
                key={item.value}
                value={item.value}
                data-pf-talento-option={`${facet}:${item.value}`}
              >
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </FieldSet>
  );
}

export type TalentFilterBarProps = {
  filters: TalentFilters;
  onChange: (next: TalentFilters) => void;
  vacancyTitleById: Readonly<Record<string, string>>;
};

export function TalentFilterBar({
  filters,
  onChange,
  vacancyTitleById,
}: TalentFilterBarProps) {
  const [open, setOpen] = React.useState(false);
  const chips = describeTalentFilters(filters, vacancyTitleById);
  const activeCount = chips.length;
  const hasActive = activeCount > 0;
  const bucket = experienceBucketValue(filters);

  const positionOptions: readonly Option[] = React.useMemo(
    () =>
      TALENT_EMPLOYER_VACANCY_IDS.map((id) => ({
        value: id,
        label: vacancyTitleById[id] ?? id,
      })),
    [vacancyTitleById],
  );
  const stageOptions: readonly Option[] = React.useMemo(
    () => TALENT_STAGES.map((stage) => ({ value: stage, label: TALENT_STAGE_LABELS[stage] })),
    [],
  );
  const sourceOptions: readonly Option[] = React.useMemo(
    () => TALENT_SOURCES.map((source) => ({ value: source, label: TALENT_SOURCE_LABELS[source] })),
    [],
  );
  const industryOptions: readonly Option[] = React.useMemo(
    () => TALENT_INDUSTRIES.map((industry) => ({ value: industry, label: industry })),
    [],
  );
  const locationOptions: readonly Option[] = React.useMemo(
    () => TALENT_LOCATIONS.map((location) => ({ value: location, label: location })),
    [],
  );
  const skillOptions: readonly Option[] = React.useMemo(
    () => TALENT_SKILLS.map((skill) => ({ value: skill, label: skill })),
    [],
  );
  const modalityOptions: readonly Option[] = React.useMemo(
    () => TALENT_MODALITIES.map((modality) => ({ value: modality, label: TALENT_MODALITY_LABELS[modality] })),
    [],
  );
  const availabilityOptions: readonly Option[] = React.useMemo(
    () =>
      TALENT_AVAILABILITIES.map((availability) => ({
        value: availability,
        label: TALENT_AVAILABILITY_LABELS[availability],
      })),
    [],
  );

  return (
    <section
      data-pf-talento-filters-region=""
      aria-label="Filtros de la base de talento"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="min-w-56 flex-1">
          <InputGroupAddon>
            <IconSearch aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            data-pf-talento-search=""
            aria-label="Buscar talento"
            placeholder="Busca por nombre, puesto, empresa o habilidad"
            value={filters.query}
            onChange={(event) =>
              onChange({ ...filters, query: event.target.value })
            }
          />
        </InputGroup>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button
                type="button"
                variant="outline"
                data-pf-talento-filter-toggle=""
              >
                <IconFilter data-icon="inline-start" aria-hidden="true" />
                Filtros
                {hasActive ? <Badge variant="secondary">{activeCount}</Badge> : null}
              </Button>
            }
          />
          <SheetContent
            side="right"
            showCloseButton={false}
            data-pf-talento-filters=""
            className="w-full gap-0 sm:max-w-md"
          >
            <SheetHeader className="border-b border-border">
              <SheetTitle>Filtros</SheetTitle>
              <SheetDescription>
                Combina criterios de perfil y de postulación. Se aplican al
                instante sobre la base de talento.
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
              <FieldGroup className="gap-5">
                <FacetMultiSelect
                  facet="position"
                  legend="Puesto"
                  options={positionOptions}
                  selected={filters.positions}
                  onChange={(next) => onChange({ ...filters, positions: next })}
                />
                <FacetMultiSelect
                  facet="stage"
                  legend="Etapa"
                  options={stageOptions}
                  selected={filters.stages}
                  onChange={(next) =>
                    onChange({ ...filters, stages: next as TalentFilters["stages"] })
                  }
                />
                <FacetMultiSelect
                  facet="source"
                  legend="Origen"
                  options={sourceOptions}
                  selected={filters.sources}
                  onChange={(next) =>
                    onChange({ ...filters, sources: next as TalentFilters["sources"] })
                  }
                />
                <FacetMultiSelect
                  facet="industry"
                  legend="Industria"
                  options={industryOptions}
                  selected={filters.industries}
                  onChange={(next) =>
                    onChange({ ...filters, industries: next as TalentFilters["industries"] })
                  }
                />
                <FacetMultiSelect
                  facet="location"
                  legend="Ubicación"
                  options={locationOptions}
                  selected={filters.locations}
                  onChange={(next) =>
                    onChange({ ...filters, locations: next as TalentFilters["locations"] })
                  }
                />
                <FacetMultiSelect
                  facet="skill"
                  legend="Habilidades"
                  options={skillOptions}
                  selected={filters.skills}
                  onChange={(next) =>
                    onChange({ ...filters, skills: next as TalentFilters["skills"] })
                  }
                />
                <FacetMultiSelect
                  facet="modality"
                  legend="Modalidad"
                  options={modalityOptions}
                  selected={filters.modalities}
                  onChange={(next) =>
                    onChange({ ...filters, modalities: next as TalentFilters["modalities"] })
                  }
                />
                <FacetMultiSelect
                  facet="availability"
                  legend="Disponibilidad"
                  options={availabilityOptions}
                  selected={filters.availability}
                  onChange={(next) =>
                    onChange({ ...filters, availability: next as TalentFilters["availability"] })
                  }
                />

                <FieldSet data-pf-talento-facet="experience" className="gap-2">
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
                          (values[0] as TalentExperienceBucketValue | undefined) ??
                            undefined,
                        ),
                      )
                    }
                    className="flex-wrap"
                  >
                    {TALENT_EXPERIENCE_BUCKETS.map((option) => (
                      <ToggleGroupItem
                        key={option.value}
                        value={option.value}
                        size="sm"
                        data-pf-talento-option={`experience:${option.value}`}
                      >
                        {option.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </FieldSet>

                <FieldSet data-pf-talento-facet="applied" className="gap-2">
                  <FieldLegend variant="label" className="mb-0">
                    Rango de postulación
                  </FieldLegend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel
                        id="talento-aplicado-desde-label"
                        htmlFor="talento-aplicado-desde"
                      >
                        Postuladas desde
                      </FieldLabel>
                      <div data-pf-talento-applied-from="">
                        <DatePickerField
                          id="talento-aplicado-desde"
                          value={filters.appliedFrom ?? ""}
                          onChange={(next) =>
                            onChange({ ...filters, appliedFrom: next || undefined })
                          }
                          aria-labelledby="talento-aplicado-desde-label"
                          allowPast
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel
                        id="talento-aplicado-hasta-label"
                        htmlFor="talento-aplicado-hasta"
                      >
                        Postuladas hasta
                      </FieldLabel>
                      <div data-pf-talento-applied-to="">
                        <DatePickerField
                          id="talento-aplicado-hasta"
                          value={filters.appliedTo ?? ""}
                          onChange={(next) =>
                            onChange({ ...filters, appliedTo: next || undefined })
                          }
                          aria-labelledby="talento-aplicado-hasta-label"
                          allowPast
                        />
                      </div>
                    </Field>
                  </div>
                  <FieldDescription>
                    Filtra por la fecha en que se recibió cada postulación.
                  </FieldDescription>
                </FieldSet>
              </FieldGroup>
            </div>

            <SheetFooter className="flex-row gap-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                data-pf-talento-clear=""
                className="flex-1"
                disabled={!hasActive}
                onClick={() => onChange(createEmptyTalentFilters())}
              >
                <IconRotate data-icon="inline-start" aria-hidden="true" />
                Limpiar filtros
              </Button>
              <SheetClose
                render={
                  <Button
                    type="button"
                    data-pf-talento-filters-close=""
                    className="flex-1"
                  />
                }
              >
                Ver resultados
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {hasActive ? (
        <div
          data-pf-talento-chips=""
          className="flex flex-wrap items-center gap-2"
        >
          {chips.map((chip) => (
            <Button
              key={chip.key}
              type="button"
              variant="outline"
              size="sm"
              data-pf-talento-chip={chip.key}
              onClick={() => onChange(removeTalentFilter(filters, chip.key))}
            >
              {chip.label}
              <IconX data-icon="inline-end" aria-hidden="true" />
              <span className="sr-only">Quitar filtro</span>
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
