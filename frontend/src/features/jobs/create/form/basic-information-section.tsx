import { FileTextIcon } from "lucide-react";

import { FieldGroup } from "@/components/ui/field";
import type { EmploymentType, Seniority, WorkMode } from "../../formatters";
import { OptionField, TextField } from "./controls";
import { FormSectionCard } from "./form-section-card";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  SENIORITY_OPTIONS,
  WORK_MODE_OPTIONS,
} from "./model";
import type { VacancyFieldErrors } from "./model";
import { sectionAnchorId, sectionTitle } from "./section-metadata";

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
    <FormSectionCard
      id={sectionAnchorId("basic-information")}
      icon={FileTextIcon}
      title={sectionTitle("basic-information")}
    >
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
          columns={3}
          value={workMode}
          error={errors.work_mode}
          onChange={onChangeWorkMode}
        />
        <FieldGroup className="gap-4">
          <OptionField
            field="employment_type"
            title="Jornada"
            options={EMPLOYMENT_TYPE_OPTIONS}
            columns={2}
            value={employmentType}
            error={errors.employment_type}
            onChange={onChangeEmploymentType}
          />
          <OptionField
            field="seniority"
            title="Seniority"
            options={SENIORITY_OPTIONS}
            columns={3}
            value={seniority}
            error={errors.seniority}
            onChange={onChangeSeniority}
          />
        </FieldGroup>
      </FieldGroup>
    </FormSectionCard>
  );
}
