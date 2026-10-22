"use client";

import { Field } from "@/components/ui/field";
import { LanguageListEditor, type LanguageValue } from "@/features/languages/language-field";
import { addLanguageRow, type DraftFormErrors, type DraftLanguageRow } from "./draft-form-state";

export type DraftLanguageFieldProps = { rows: DraftLanguageRow[]; errors: DraftFormErrors; onChange: (rows: DraftLanguageRow[]) => void };

/** Adapt the shared editor's level control to H3's minimum-level wire key. */
export function DraftLanguageField({ rows, errors, onChange }: DraftLanguageFieldProps) {
  return <Field tabIndex={-1} aria-label="Idiomas requeridos" aria-invalid={!!errors.languages}>
    <LanguageListEditor maxItems={20} levelLabel="Nivel mínimo del idioma"
    value={rows.map(row => ({ code: row.code, level: row.min_level as LanguageValue["level"] }))}
    issues={Object.entries(errors).map(([path, message]) => ({ path: path.replace(/^(languages\.\d+)$/u, "$1.code").replace(/\.min_level$/u, ".level"), message }))}
    onChange={next => {
      // The shared editor appends or removes one row, otherwise edits in place.
      const previous = next.length > rows.length ? addLanguageRow(rows) : rows;
      onChange(next.map((row, index) => ({ id: previous[index]?.id ?? `language-${index + 1}`, code: row.code, min_level: row.level })));
    }} />
  </Field>;
}
