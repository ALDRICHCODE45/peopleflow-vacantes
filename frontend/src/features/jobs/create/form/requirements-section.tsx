import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
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
 * Only the description is rich: it owns the safe tokenized editor whose plain
 * text feeds the contract, while the requirements are plain, local-only text.
 * They therefore stay plain `Textarea` controls with no toolbar, so nothing can
 * rewrite requirement text the contract will eventually receive as written. The
 * module owns no card: the step shell renders the surface.
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
    <FieldGroup className="gap-6">
      <RichTextField
        id={controlId("description")}
        errorId={errorId("description")}
        label="Descripción del puesto"
        value={descriptionRich}
        error={descriptionError}
        onChange={onChangeDescriptionRich}
        rows={6}
        placeholder="Describe el rol, el equipo y el impacto del puesto."
      />

      <PlainRequirementField
        id="vacancy-required-requirements"
        label="Requisitos obligatorios"
        value={requiredRequirements}
        onChange={onChangeRequiredRequirements}
        placeholder="Ej.: 5 años de experiencia con React y TypeScript."
      />

      <PlainRequirementField
        id="vacancy-preferred-requirements"
        label="Requisitos deseables"
        value={preferredRequirements}
        onChange={onChangePreferredRequirements}
        placeholder="Ej.: Experiencia previa con PostgreSQL."
      />
    </FieldGroup>
  );
}

type PlainRequirementFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

/**
 * One requirement surface: the installed `Textarea` behind its own label, with
 * the local value and the caller's callback. It carries no formatting toolbar
 * and no preview, because requirement text is stored exactly as written.
 */
function PlainRequirementField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: PlainRequirementFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        name={id}
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </Field>
  );
}
