import { useState } from "react";
import { Plus } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { add, canAdd, validate, type SubstatesEditorState } from "@/features/jobs/drafts/pipeline/substates-model";
import { nameError } from "./row";

export function CustomSubstateInput({ state, disabled, onAdd }: {
  state: SubstatesEditorState; disabled: boolean; onAdd: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const candidate = add(state, name);
  const entry = candidate.entries.at(-1);
  const message = !canAdd(state) ? `Llegaste al máximo de ${state.limits.maxSubstates} subestados.`
    : nameError(entry ? validate(candidate).errors[entry.key] : undefined, state.limits.nameMaxLength);
  const error = attempted ? message : undefined;
  function submit() {
    if (disabled) return;
    setAttempted(true);
    if (message) return;
    onAdd(name); setName(""); setAttempted(false);
  }
  return <FieldGroup><Field data-invalid={!!error} data-disabled={disabled}>
    <FieldLabel htmlFor="custom-substate">O crea un subestado personalizado</FieldLabel>
    <InputGroup className="min-h-10">
      <InputGroupInput id="custom-substate" className="min-h-10" placeholder="Ej. Entrevista técnica" value={name} disabled={disabled}
        aria-invalid={!!error} aria-describedby={`custom-substate-help${error ? " custom-substate-error" : ""}`}
        onChange={event => { setName(event.target.value); setAttempted(false); }}
        onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-sm" className="size-10" aria-label="Agregar subestado" disabled={disabled} onClick={submit}><Plus aria-hidden="true" /></InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
    <FieldDescription id="custom-substate-help">Hasta {state.limits.nameMaxLength} caracteres. Presiona Enter para agregar.</FieldDescription>
    {error && <FieldError id="custom-substate-error">{error}</FieldError>}
  </Field></FieldGroup>;
}
