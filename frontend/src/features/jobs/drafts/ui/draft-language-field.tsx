"use client";

import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addLanguageRow,
  removeLanguageRow,
  updateLanguageRow,
  type DraftFormErrors,
  type DraftLanguageRow,
} from "./draft-form-state";
import { LANGUAGE_LEVEL_OPTIONS, LANGUAGE_OPTIONS } from "./draft-labels";

/** Contract bound of the `languages` list. */
const LANGUAGES_MAX_ITEMS = 100;

/**
 * Repeatable language rows. The language and level are exact contract enums
 * with no CEFR conversion; `custom_name` is only captured for `other`, and its
 * raw buffer survives a language change instead of being silently erased.
 */
export type DraftLanguageFieldProps = {
  rows: DraftLanguageRow[];
  errors: DraftFormErrors;
  onChange: (rows: DraftLanguageRow[]) => void;
};

export function DraftLanguageField({ rows, errors, onChange }: DraftLanguageFieldProps) {
  const atLimit = rows.length >= LANGUAGES_MAX_ITEMS;

  return (
    <FieldGroup className="gap-4">
      {rows.length === 0 ? (
        <FieldDescription>
          Sin idiomas por ahora. Puedes agregar hasta {LANGUAGES_MAX_ITEMS}.
        </FieldDescription>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((row, index) => {
            const position = index + 1;
            const languageId = `draft-language-${position}`;
            const customNameId = `draft-language-name-${position}`;
            const levelId = `draft-language-level-${position}`;
            const languageLabel = `Idioma ${position}`;
            const languageError =
              errors[`languages.${index}.language`] ?? errors[`languages.${index}`];
            const customNameError = errors[`languages.${index}.custom_name`];

            return (
              <div key={row.id} className="flex flex-col gap-3 rounded-2xl bg-muted/30 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Field data-invalid={languageError !== undefined} className="min-w-40 flex-1">
                    <FieldTitle id={`${languageId}-label`}>{languageLabel}</FieldTitle>
                    <Select
                      value={row.language === "" ? null : row.language}
                      items={LANGUAGE_OPTIONS}
                      onValueChange={(next) =>
                        onChange(updateLanguageRow(rows, row.id, { language: next ?? "" }))
                      }
                    >
                      <SelectTrigger
                        id={languageId}
                        aria-labelledby={`${languageId}-label`}
                        aria-invalid={languageError !== undefined}
                        aria-describedby={
                          languageError === undefined
                            ? undefined
                            : `${languageId}-error`
                        }
                        className="h-10 w-full"
                      >
                        <SelectValue placeholder="Elige un idioma" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {LANGUAGE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldError id={`${languageId}-error`}>{languageError}</FieldError>
                  </Field>

                  <Field className="min-w-40 flex-1">
                    <FieldTitle id={`${levelId}-label`}>Nivel del idioma {position}</FieldTitle>
                    <Select
                      value={row.level === "" ? null : row.level}
                      items={LANGUAGE_LEVEL_OPTIONS}
                      onValueChange={(next) =>
                        onChange(updateLanguageRow(rows, row.id, { level: next ?? "" }))
                      }
                    >
                      <SelectTrigger
                        id={levelId}
                        aria-labelledby={`${levelId}-label`}
                        className="h-10 w-full"
                      >
                        <SelectValue placeholder="Sin definir" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {LANGUAGE_LEVEL_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Quitar idioma ${position}`}
                    onClick={() => onChange(removeLanguageRow(rows, row.id))}
                  >
                    <XIcon />
                  </Button>
                </div>

                {row.language === "other" ? (
                  <Field data-invalid={customNameError !== undefined}>
                    <FieldTitle id={`${customNameId}-label`}>
                      Nombre del idioma {position}
                    </FieldTitle>
                    <Input
                      id={customNameId}
                      name={customNameId}
                      value={row.customName}
                      placeholder="Ej. Francés"
                      autoComplete="off"
                      aria-labelledby={`${customNameId}-label`}
                      aria-invalid={customNameError !== undefined}
                      aria-describedby={
                        customNameError === undefined ? undefined : `${customNameId}-error`
                      }
                      onChange={(event) =>
                        onChange(
                          updateLanguageRow(rows, row.id, { customName: event.target.value }),
                        )
                      }
                    />
                    <FieldError id={`${customNameId}-error`}>{customNameError}</FieldError>
                  </Field>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={atLimit}
          onClick={() => onChange(addLanguageRow(rows))}
        >
          <PlusIcon data-icon="inline-start" />
          Agregar idioma
        </Button>
        <FieldDescription>
          {rows.length} de {LANGUAGES_MAX_ITEMS}
        </FieldDescription>
      </div>
    </FieldGroup>
  );
}
