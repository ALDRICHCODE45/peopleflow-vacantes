import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput,
  ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue,
} from "@/components/ui/combobox";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Field, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CEFR_LEVEL_OPTIONS, DEPARTMENTS, LANGUAGES, MAX_LANGUAGES, MAX_SKILLS, SKILLS,
  addLanguageRequirement, removeLanguageRequirement, updateLanguageRequirement,
  type CefrLevel, type LanguageRequirement, type VacancyPrototypeValues,
} from "./prototype-model";

/**
 * Local-only strategy fields, partitioned so the four-step wizard can place each
 * one in the step that owns the task: department in "Información básica",
 * technologies and languages in "Perfil del puesto", and the closing date in
 * "Condiciones y proceso".
 *
 * Every value is caller-owned prototype state written through the immutable
 * model helpers, so the caller keeps stable row identities. The module owns no
 * card and no section chrome: the step shell renders that once per step.
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

export type StrategyFieldProps = {
  /** Caller-owned local-only prototype state. */
  values: VacancyPrototypeValues;
  onChange: (next: VacancyPrototypeValues) => void;
};

/** Area or department of the vacancy; local-only, so no wire field backs it. */
export type DepartmentFieldProps = {
  department: string;
  onChangeDepartment: (value: string) => void;
};

export function DepartmentField({ department, onChangeDepartment }: DepartmentFieldProps) {
  return (
    <Field>
      <FieldTitle id={DEPARTMENT_TITLE_ID}>Área o departamento</FieldTitle>
      <Select
        value={department === "" ? null : department}
        onValueChange={(next) => { if (next !== null) onChangeDepartment(next); }}
        items={DEPARTMENT_ITEMS}
      >
        <SelectTrigger aria-labelledby={DEPARTMENT_TITLE_ID} className="h-10 w-full">
          <SelectValue placeholder="Elige un área" />
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
  );
}

/** Searchable multi-select of technologies, capped at the prototype maximum. */
export function SkillsField({ values, onChange }: StrategyFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={SKILLS_INPUT_ID}>Habilidades y tecnologías</FieldLabel>
      <Combobox
        multiple
        value={values.skills}
        onValueChange={(next: string[]) =>
          onChange({ ...values, skills: capSelectedSkills(next) })
        }
      >
        <ComboboxChips>
          <ComboboxValue>
            {(selected: string[]) => (
              <>
                {selected.map((skill) => (
                  <ComboboxChip key={skill}>{skill}</ComboboxChip>
                ))}
                <ComboboxChipsInput id={SKILLS_INPUT_ID} placeholder="Busca una tecnología" />
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
  );
}

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
            <SelectValue placeholder="Elige el nivel" />
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

/**
 * Row list of required languages. Adding, patching, and removing all go through
 * the immutable prototype helpers, so identities and order stay stable.
 */
export function LanguagesField({ values, onChange }: StrategyFieldProps) {
  const atLanguageLimit = values.languages.length >= MAX_LANGUAGES;

  function addLanguage() {
    const next = addLanguageRequirement(values.languages, {
      id: nextRowId("language", values.languages),
      language: "",
      level: "",
    });
    if (next !== values.languages) onChange({ ...values, languages: next });
  }

  return (
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
            onChange({
              ...values,
              languages: updateLanguageRequirement(values.languages, language.id, patch),
            })
          }
          onRemove={() =>
            onChange({
              ...values,
              languages: removeLanguageRequirement(values.languages, language.id),
            })
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
  );
}

/** Optional application deadline; a local-only value with no wire field. */
export function ClosingDateField({ values, onChange }: StrategyFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={CLOSING_DATE_ID}>
        Fecha de cierre<span className="text-muted-foreground">(opcional)</span>
      </FieldLabel>
      <DatePickerField
        id={CLOSING_DATE_ID}
        value={values.closingDate}
        onChange={(next) => onChange({ ...values, closingDate: next })}
      />
      <FieldDescription>Fecha límite para recibir postulaciones.</FieldDescription>
    </Field>
  );
}
