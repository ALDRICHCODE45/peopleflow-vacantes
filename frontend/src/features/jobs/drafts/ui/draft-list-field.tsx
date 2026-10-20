"use client";

import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addListRow,
  removeListRow,
  updateListRow,
  type DraftFormErrors,
  type DraftListRow,
} from "./draft-form-state";

/**
 * One repeatable free-text list field (skills, complementary benefits,
 * screening questions).
 *
 * Rows keep their raw values while typing. Every row owns a labelled control and
 * an accessible removal button, and the add control states the contract bound
 * instead of a legacy cap.
 */
export type DraftListFieldProps = {
  /** Deterministic id and row-id prefix. */
  idPrefix: string;
  /** Singular Spanish row noun, used by labels and removal buttons. */
  rowNoun: string;
  addLabel: string;
  rows: DraftListRow[];
  errors: DraftFormErrors;
  /** Error key prefix, matching the contract field name. */
  errorPrefix: string;
  /** Contract maximum item count. */
  max: number;
  placeholder?: string;
  /** Screens long prompts with a textarea instead of a single-line input. */
  multiline?: boolean;
  onChange: (rows: DraftListRow[]) => void;
};

export function DraftListField({
  idPrefix,
  rowNoun,
  addLabel,
  rows,
  errors,
  errorPrefix,
  max,
  placeholder,
  multiline = false,
  onChange,
}: DraftListFieldProps) {
  // Keep editable raw rows (including blanks/errors), rather than v0's trim-on-add chips.
  const atLimit = rows.length >= max;
  const lowerNoun = rowNoun.toLocaleLowerCase("es");

  return (
    <FieldGroup className="gap-4">
      {rows.length === 0 ? (
        <FieldDescription>
          Sin elementos por ahora. Puedes agregar hasta {max}.
        </FieldDescription>
      ) : (
        <FieldGroup className={multiline ? "gap-4" : "grid gap-4 sm:grid-cols-2 [&>*]:min-w-0"}>
          {rows.map((row, index) => {
            const id = `${idPrefix}-${index + 1}`;
            const errorId = `${id}-error`;
            const rowErrorKey = `${errorPrefix}.${index}`;
            const error = errors[rowErrorKey] ?? (
              errorPrefix === "screening_questions"
                ? errors[`${rowErrorKey}.prompt`]
                : undefined
            );
            const label = `${rowNoun} ${index + 1}`;
            return (
              <div key={row.id} className="flex items-end gap-2">
                <Field data-invalid={error !== undefined}>
                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
                  {multiline ? (
                    <Textarea
                      id={id}
                      name={id}
                      rows={3}
                      value={row.value}
                      placeholder={placeholder}
                      aria-invalid={error !== undefined}
                      aria-describedby={error === undefined ? undefined : errorId}
                      onChange={(event) =>
                        onChange(updateListRow(rows, row.id, event.target.value))
                      }
                    />
                  ) : (
                    <Input
                      id={id}
                      name={id}
                      value={row.value}
                      placeholder={placeholder}
                      autoComplete="off"
                      className="min-h-10"
                      aria-invalid={error !== undefined}
                      aria-describedby={error === undefined ? undefined : errorId}
                      onChange={(event) =>
                        onChange(updateListRow(rows, row.id, event.target.value))
                      }
                    />
                  )}
                  <FieldError id={errorId}>{error}</FieldError>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10 shrink-0"
                  aria-label={`Quitar ${lowerNoun} ${index + 1}`}
                  onClick={() => onChange(removeListRow(rows, row.id))}
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}
        </FieldGroup>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          disabled={atLimit}
          onClick={() => onChange(addListRow(rows, idPrefix))}
        >
          <PlusIcon data-icon="inline-start" />
          {addLabel}
        </Button>
        <FieldDescription>
          {rows.length} de {max}
        </FieldDescription>
      </div>
    </FieldGroup>
  );
}
