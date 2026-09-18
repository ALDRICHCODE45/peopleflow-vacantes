import { FileTextIcon } from "lucide-react";

import { FieldGroup } from "@/components/ui/field";
import type { EmploymentType, Seniority, WorkMode } from "../../formatters";
import { FormSection, OptionField, TextField } from "./controls";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  SENIORITY_OPTIONS,
  WORK_MODE_OPTIONS,
} from "./model";
import type { VacancyFieldErrors } from "./model";

export type BasicInformationSectionProps = {
  title: string;
  location: string;
  workMode: WorkMode | "";
  employmentType: EmploymentType | "";
  seniority: Seniority | "";
  /** Shared error slots; this section only reads the fields it owns. */
  errors: VacancyFieldErrors;
  onChangeTitle: (value: string) => void;
  onChangeLocation: (value: string) => void;
  onChangeWorkMode: (value: WorkMode | "") => void;
  onChangeEmploymentType: (value: EmploymentType | "") => void;
  onChangeSeniority: (value: Seniority | "") => void;
};

/** Title, location, and the three required contract enums. */
export function BasicInformationSection({
  title,
  location,
  workMode,
  employmentType,
  seniority,
  errors,
  onChangeTitle,
  onChangeLocation,
  onChangeWorkMode,
  onChangeEmploymentType,
  onChangeSeniority,
}: BasicInformationSectionProps) {
  return (
    <FormSection icon={FileTextIcon} title="Información básica">
      <FieldGroup className="gap-4">
        <TextField
          field="title"
          label="Título del puesto"
          value={title}
          error={errors.title}
          onChange={onChangeTitle}
          placeholder="Ej.: Backend Developer (Senior)"
        />
        <TextField
          field="location"
          label="Ubicación"
          optional
          value={location}
          error={errors.location}
          onChange={onChangeLocation}
          placeholder="Ej.: Monterrey, NL"
        />
        <OptionField
          field="work_mode"
          title="Modalidad"
          options={WORK_MODE_OPTIONS}
          value={workMode}
          error={errors.work_mode}
          onChange={onChangeWorkMode}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <OptionField
            field="employment_type"
            title="Jornada"
            options={EMPLOYMENT_TYPE_OPTIONS}
            value={employmentType}
            error={errors.employment_type}
            onChange={onChangeEmploymentType}
          />
          <OptionField
            field="seniority"
            title="Seniority"
            options={SENIORITY_OPTIONS}
            value={seniority}
            error={errors.seniority}
            onChange={onChangeSeniority}
          />
        </div>
      </FieldGroup>
    </FormSection>
  );
}
