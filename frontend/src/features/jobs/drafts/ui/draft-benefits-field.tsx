"use client";

import { ChoiceList } from "@/components/ui/choice-list";
import { BENEFITS } from "../lists";
import { benefitLabel } from "./draft-labels";

/**
 * Fixed-catalog benefit selection. The eight approved codes render as `ChoiceList` rows
 * in catalog order with a «Seleccionar todo» first row; toggling one preserves the
 * submitted selection order and only catalog codes can enter the value.
 */
export type DraftBenefitsFieldProps = {
  selected: string[];
  onChange: (selected: string[]) => void;
};

const OPTIONS = BENEFITS.map((code) => ({ value: code, title: benefitLabel(code) }));

export function DraftBenefitsField({ selected, onChange }: DraftBenefitsFieldProps) {
  return (
    <ChoiceList
      multiple
      legend="Prestaciones"
      options={OPTIONS}
      value={selected}
      onValueChange={onChange}
      countLabel={(chosen, total) => (chosen === 0 ? "Ninguna elegida" : `${chosen} de ${total} elegidas`)}
    />
  );
}
