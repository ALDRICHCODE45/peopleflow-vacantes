import { ClipboardListIcon } from "lucide-react";

import { FieldGroup } from "@/components/ui/field";
import { FormSection } from "./controls";
import { controlId, errorId } from "./model";
import { RichTextField } from "./rich-text-field";

export type RequirementsSectionProps = {
  /**
   * Tokenized rich description. It owns the rich editing surface and stays
   * local-only; the contract derives its plain `description` from it.
   */
  descriptionRich: string;
  /** Local-only prototype requirements. */
  requiredRequirements: string;
  preferredRequirements: string;
  /** Present only while the derived contract description is invalid. */
  descriptionError?: string;
  onChangeDescriptionRich: (value: string) => void;
  onChangeRequiredRequirements: (value: string) => void;
  onChangePreferredRequirements: (value: string) => void;
};

/**
 * Description plus the two requirement surfaces.
 *
 * All three fields share the same safe formatting field, so the token model is
 * implemented once. The description's formatting is local-only while its plain
 * text feeds the contract; the two requirement fields are local-only prototype
 * state and say so.
 */
export function RequirementsSection({
  descriptionRich,
  requiredRequirements,
  preferredRequirements,
  descriptionError,
  onChangeDescriptionRich,
  onChangeRequiredRequirements,
  onChangePreferredRequirements,
}: RequirementsSectionProps) {
  return (
    <FormSection icon={ClipboardListIcon} title="Descripción y requisitos">
      <FieldGroup className="gap-6">
        <RichTextField
          id={controlId("description")}
          errorId={errorId("description")}
          label="Descripción del puesto"
          value={descriptionRich}
          error={descriptionError}
          onChange={onChangeDescriptionRich}
          rows={6}
          placeholder="Describí el rol, el equipo y el impacto del puesto."
        />

        <RichTextField
          id="vacancy-required-requirements"
          label="Requisitos obligatorios"
          value={requiredRequirements}
          onChange={onChangeRequiredRequirements}
          prototype
          placeholder="Ej.: 5 años de experiencia con React y TypeScript."
        />

        <RichTextField
          id="vacancy-preferred-requirements"
          label="Requisitos deseables"
          value={preferredRequirements}
          onChange={onChangePreferredRequirements}
          prototype
          placeholder="Ej.: Experiencia previa con PostgreSQL."
        />
      </FieldGroup>
    </FormSection>
  );
}
