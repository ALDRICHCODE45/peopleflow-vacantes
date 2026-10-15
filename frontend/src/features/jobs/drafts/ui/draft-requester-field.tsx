"use client";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DraftRequesterKind, DraftRequesterState } from "./draft-form-state";
import { REQUESTER_CATALOG_UNAVAILABLE } from "./draft-messages";
import { REQUESTER_KIND_OPTIONS } from "./draft-labels";

/**
 * Truthful partial requester control.
 *
 * The type is a real local choice; the name catalog is not connected yet, so the
 * name selector is an honest disabled control instead of a fabricated list and
 * there is no manual identifier input. The supplied requester and its derived
 * name survive untouched until the type is explicitly changed, and that change
 * visibly explains the cleared selection.
 */
export type DraftRequesterFieldProps = {
  requester: DraftRequesterState;
  error?: string;
  onChangeKind: (kind: DraftRequesterKind) => void;
};

export function DraftRequesterField({
  requester,
  error,
  onChangeKind,
}: DraftRequesterFieldProps) {
  const nameItems =
    requester.name === null ? [] : [{ value: requester.name, label: requester.name }];

  return (
    <FieldGroup className="gap-4">
      <Field data-invalid={error !== undefined}>
        <FieldTitle id="draft-requester-kind-label">Tipo de solicitante</FieldTitle>
        <Select
          value={requester.kind}
          items={REQUESTER_KIND_OPTIONS}
          onValueChange={(next) => onChangeKind((next ?? "internal_area") as DraftRequesterKind)}
        >
          <SelectTrigger
            id="draft-requester-kind"
            aria-labelledby="draft-requester-kind-label"
            aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? undefined : "draft-requester-kind-error"}
            className="h-10 w-full"
          >
            <SelectValue placeholder="Elige un tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {REQUESTER_KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldError id="draft-requester-kind-error">{error}</FieldError>
      </Field>

      <Field>
        <FieldTitle id="draft-requester-name-label">Área o cliente</FieldTitle>
        <Select value={requester.name} items={nameItems} disabled>
          <SelectTrigger
            id="draft-requester-name"
            aria-labelledby="draft-requester-name-label"
            disabled
            className="h-10 w-full"
          >
            <SelectValue placeholder="Catálogo no disponible" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {nameItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>{REQUESTER_CATALOG_UNAVAILABLE}</FieldDescription>
      </Field>

      {requester.notice === null ? null : (
        <p
          role="status"
          data-pf-requester-notice=""
          className="text-sm text-muted-foreground"
        >
          {requester.notice}
        </p>
      )}
    </FieldGroup>
  );
}
