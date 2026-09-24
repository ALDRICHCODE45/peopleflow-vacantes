import { PlusIcon, TargetIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput,
  ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue,
} from "@/components/ui/combobox";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FormSectionCard } from "./form-section-card";
import {
  CEFR_LEVEL_OPTIONS, DEPARTMENTS, LANGUAGES, MAX_LANGUAGES, MAX_SKILLS, SKILLS,
  addLanguageRequirement, removeLanguageRequirement, updateLanguageRequirement,
  type CefrLevel, type LanguageRequirement, type VacancyPrototypeValues,
} from "./prototype-model";
import { sectionAnchorId, sectionTitle } from "./section-metadata";

/**
 * Local-only strategy fields: area, technologies, languages, and closing date.
 * Every value is caller-owned prototype state written through the immutable
 * model helpers, so the caller keeps stable row identities.
 */
const DEPARTMENT_TITLE_ID = "vacancy-department-title";
const SKILLS_INPUT_ID = "vacancy-skills";
const LANGUAGES_TITLE_ID = "vacancy-languages-title";
const LANGUAGE_OPTIONS_ID = "vacancy-language-options";
const CLOSING_DATE_ID = "vacancy-closing-date";

const DEPARTMENT_ITEMS = DEPARTMENTS.map((value) => ({ label: value, value }));
const LEVEL_ITEMS = CEFR_LEVEL_OPTIONS.map((option) => ({
  label: `${option.value} · ${option.label}`,
  value: option.value,
}));

/** Keeps the technology selection inside the prototype limit. */
export function capSelectedSkills(skills: readonly string[]): string[] {
  return skills.slice(0, MAX_SKILLS);
}

/** Narrows an option-set value back to the prototype language band. */
export function pickCefr(candidate: string | null): CefrLevel | "" {
  return CEFR_LEVEL_OPTIONS.find((option) => option.value === candidate)?.value ?? "";
}

/** Next unused identifier, derived only from the current state. */
function nextRowId(prefix: string, used: readonly { id: string }[]): string {
  let index = 1;
  while (used.some((row) => row.id === `${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}
export type StrategySectionProps = {
  /** Caller-owned local-only prototype state. */
  values: VacancyPrototypeValues;
  onChange: (next: VacancyPrototypeValues) => void;
};

type LanguagePatch = { language?: string; level?: CefrLevel | "" };

type LanguageRowProps = {
  language: LanguageRequirement; index: number;
  onPatch: (patch: LanguagePatch) => void; onRemove: () => void;
};
/** One language: a name with catalog suggestions plus a CEFR band. */
function LanguageRow({ language, index, onPatch, onRemove }: LanguageRowProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
      <Field>
        <FieldLabel htmlFor={`${language.id}-language`}>Idioma {index + 1}</FieldLabel>
        <Input
          id={`${language.id}-language`} list={LANGUAGE_OPTIONS_ID}
          value={language.language} placeholder="Ej.: Inglés" autoComplete="off"
          onChange={(event) => onPatch({ language: event.target.value })}
        />
      </Field>

      <Field>
        <FieldTitle id={`${language.id}-level-title`}>Nivel {index + 1}</FieldTitle>
        <Select
          value={language.level === "" ? null : language.level} items={LEVEL_ITEMS}
          onValueChange={(next) => onPatch({ level: pickCefr(next) })}
        >
          <SelectTrigger aria-labelledby={`${language.id}-level-title`} className="w-full">
            <SelectValue placeholder="Elegí el nivel" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {LEVEL_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Button type="button" variant="ghost" size="icon" aria-label={`Quitar idioma ${index + 1}`} onClick={onRemove}>
        <XIcon />
      </Button>
    </div>
  );
}

export function StrategySection({ values, onChange }: StrategySectionProps) {
  const atLanguageLimit = values.languages.length >= MAX_LANGUAGES;

  const update = (patch: Partial<VacancyPrototypeValues>) =>
    onChange({ ...values, ...patch });

  function addLanguage() {
    const next = addLanguageRequirement(values.languages, {
      id: nextRowId("language", values.languages),
      language: "",
      level: "",
    });
    if (next !== values.languages) update({ languages: next });
  }

  return (
    <FormSectionCard
      id={sectionAnchorId("strategy")}
      icon={TargetIcon}
      title={sectionTitle("strategy")}
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldTitle id={DEPARTMENT_TITLE_ID}>Área o departamento</FieldTitle>
          <Select
            value={values.department === "" ? null : values.department}
            onValueChange={(next) => { if (next !== null) update({ department: next }); }}
            items={DEPARTMENT_ITEMS}
          >
            <SelectTrigger aria-labelledby={DEPARTMENT_TITLE_ID} className="w-full">
              <SelectValue placeholder="Elegí un área" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {DEPARTMENT_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={SKILLS_INPUT_ID}>Habilidades y tecnologías</FieldLabel>
          <Combobox
            multiple
            value={values.skills}
            onValueChange={(next: string[]) => update({ skills: capSelectedSkills(next) })}
          >
            <ComboboxChips>
              <ComboboxValue>
                {(selected: string[]) => (
                  <>
                    {selected.map((skill) => (
                      <ComboboxChip key={skill}>{skill}</ComboboxChip>
                    ))}
                    <ComboboxChipsInput id={SKILLS_INPUT_ID} placeholder="Buscá una tecnología" />
                  </>
                )}
              </ComboboxValue>
            </ComboboxChips>
            <ComboboxContent>
              <ComboboxEmpty>Sin resultados</ComboboxEmpty>
              <ComboboxList>
                {SKILLS.map((skill) => (
                  <ComboboxItem key={skill} value={skill}>{skill}</ComboboxItem>
                ))}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <FieldDescription>{values.skills.length} de {MAX_SKILLS} tecnologías seleccionadas.</FieldDescription>
        </Field>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldTitle id={LANGUAGES_TITLE_ID}>Idiomas y nivel</FieldTitle>
            <Button type="button" variant="outline" size="sm" disabled={atLanguageLimit} onClick={addLanguage}>
              <PlusIcon data-icon="inline-start" />
              Agregar idioma
            </Button>
          </div>

          {values.languages.map((language, index) => (
            <LanguageRow
              key={language.id}
              language={language}
              index={index}
              onPatch={(patch) =>
                update({ languages: updateLanguageRequirement(values.languages, language.id, patch) })
              }
              onRemove={() =>
                update({ languages: removeLanguageRequirement(values.languages, language.id) })
              }
            />
          ))}

          <datalist id={LANGUAGE_OPTIONS_ID}>
            {LANGUAGES.map((language) => (<option key={language} value={language} />))}
          </datalist>

          {atLanguageLimit && (
            <FieldDescription>Alcanzaste el máximo de {MAX_LANGUAGES} idiomas.</FieldDescription>
          )}
        </div>

        <Field>
          <FieldLabel htmlFor={CLOSING_DATE_ID}>
            Fecha de cierre<span className="text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <DatePickerField
            id={CLOSING_DATE_ID}
            value={values.closingDate}
            onChange={(next) => update({ closingDate: next })}
          />
          <FieldDescription>Fecha límite para recibir postulaciones.</FieldDescription>
        </Field>
      </FieldGroup>
    </FormSectionCard>
  );
}
