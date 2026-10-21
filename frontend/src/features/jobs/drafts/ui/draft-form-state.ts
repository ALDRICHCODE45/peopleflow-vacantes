import { ZodError, type z } from "zod";
import { locationErrorMessages, remoteScopeErrorMessages, locationValueToWrite, type LocationValue, type RemoteScopeWrite, type GeoReference } from "@/features/geo/model";

import { BENEFITS } from "../lists";
import { draftModelToPostBody, type DraftModel } from "../model";
import type { DraftRichDescription } from "../rich/grammar";
import {
  BENEFITS_ERROR,
  COMPENSATION_AMOUNT_ERROR,
  COMPENSATION_ERROR,
  COMPENSATION_RANGE_ERROR,
  DESCRIPTION_ERROR,
  ENUM_ERROR,
  GENERIC_ERROR,
  LANGUAGE_REQUIRED_ERROR,
  LIST_ITEM_DUPLICATE_ERROR,
  LIST_ITEM_EMPTY_ERROR,
  LIST_ITEM_TOO_LONG_ERROR,
  MODEL_ERROR,
  REQUESTER_ERROR,
  REQUIREMENTS_ERROR,
  SCREENING_EMPTY_ERROR,
  SCREENING_TOO_LONG_ERROR,
  TITLE_ERROR,
  WORK_MODE_ERROR,
} from "./draft-messages";

/**
 * Raw local form state of the complete 17-field draft editor.
 *
 * Every control owns the raw text the user typed. Nothing is trimmed, parsed or
 * normalized while typing: the accepted schemas run only inside
 * `validateDraftFormState`, which composes the complete model and hands it to
 * the accepted full serializer `draftModelToPostBody`. Values that are
 * conditionally inactive (compensation amounts, language `custom_name`) stay
 * buffered here so switching a mode never silently erases what was typed.
 */

/** Accepted `requester.kind` literals. */
export type DraftRequesterKind = "internal_area" | "client";

/** One repeatable free-text row with a stable local identity. */
export type DraftListRow = { id: string; value: string };

/** Requester state: the supplied value plus the visual type control. */
export type DraftRequesterState = {
  /** Validated requester of the initial model, preserved on a no-op. */
  original: { kind: DraftRequesterKind; id: string | null } | null;
  /** Visual type; the contract initial visual type is `internal_area`. */
  kind: DraftRequesterKind;
  /** Supplied catalog id; never editable by hand. */
  id: string | null;
  /** Supplied catalog name; display only, never rewritten locally. */
  name: string | null;
  /** True once the user explicitly changed the visual type. */
  changed: boolean;
  /** Visible explanation of a cleared selection, if any. */
  notice: string | null;
};

/** One repeatable language row; `customName` is a buffer for `other`. */
export type DraftLanguageRow = {
  id: string;
  code: string;
  min_level: string;
};

/** Raw compensation controls; every money value is the exact typed string. */
export type DraftCompensationState = {
  mode: string;
  amount: string;
  min: string;
  max: string;
  currency: string;
  pay_period: string;
  basis: string;
  public_visible: boolean;
};

/** Complete raw editor state: one control for each writable contract field. */
export type DraftFormState = {
  title: string;
  location: LocationValue;
  locationLabel: string | null;
  remote_scope: RemoteScopeWrite;
  remoteCountries: GeoReference[];
  work_mode: string;
  work_schedule: string;
  contract_type: string;
  seniority: string;
  min_years_of_experience: string;
  min_education_level: string;
  accepts_in_progress_education: boolean;
  professional_area: string;
  required_requirements: string;
  preferred_requirements: string;
  skills: DraftListRow[];
  custom_benefits: DraftListRow[];
  benefits: string[];
  screening_questions: DraftListRow[];
  requester: DraftRequesterState;
  languages: DraftLanguageRow[];
  compensation: DraftCompensationState;
  description: DraftRichDescription;
};

/** Field-path keyed errors (`title`, `skills.0`, `compensation.min`, …). */
export type DraftFormErrors = Record<string, string>;

/** Atomic validation outcome: a complete model or the field errors. */
export type DraftValidationResult =
  | { ok: true; model: DraftModel }
  | { ok: false; errors: DraftFormErrors };

/** Next unused deterministic row id for one prefix. */
function nextRowId(prefix: string, rows: readonly { id: string }[]): string {
  let index = 1;
  while (rows.some((row) => row.id === `${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

/** Seeds rows from validated string values, one deterministic id each. */
function toRows(prefix: string, values: readonly string[]): DraftListRow[] {
  return values.map((value, index) => ({ id: `${prefix}-${index + 1}`, value }));
}

/** Raw seed of every control from a complete accepted model. */
export function initialDraftFormState(model: DraftModel): DraftFormState {
  const fields = model.fields;
  const requester = fields.requester;
  return {
    title: fields.title ?? "",
    location: { country: fields.location?.country ?? null, state: fields.location?.state ?? null, municipality: fields.location?.municipality ?? null, postal_code: fields.location?.postal_code ?? null },
    locationLabel: model.locationRead?.label ?? null,
    remote_scope: structuredClone(fields.remote_scope),
    remoteCountries: model.remoteScopeRead?.kind === "countries" ? model.remoteScopeRead.countries : [],
    work_mode: fields.work_mode ?? "",
    work_schedule: fields.work_schedule ?? "",
    contract_type: fields.contract_type ?? "",
    seniority: fields.seniority ?? "",
    min_years_of_experience: fields.min_years_of_experience ?? "",
    min_education_level: fields.min_education_level ?? "",
    accepts_in_progress_education: fields.accepts_in_progress_education,
    professional_area: fields.professional_area ?? "",
    required_requirements: fields.required_requirements ?? "",
    preferred_requirements: fields.preferred_requirements ?? "",
    skills: toRows("skill", fields.skills),
    custom_benefits: toRows("custom-benefit", fields.custom_benefits),
    benefits: [...fields.benefits],
    screening_questions: fields.screening_questions.map((question, index) => ({
      id: `screening-${index + 1}`,
      value: question.prompt,
    })),
    requester: {
      original: requester === null ? null : { kind: requester.kind, id: requester.id },
      kind: requester?.kind ?? "internal_area",
      id: requester?.id ?? null,
      name: model.requesterName,
      changed: false,
      notice: null,
    },
    languages: fields.languages.map((item, index) => ({
      id: `language-${index + 1}`,
      code: item.code,
      min_level: item.min_level,
    })),
    compensation: {
      mode: fields.compensation.mode ?? "",
      amount: fields.compensation.amount ?? "",
      min: fields.compensation.min ?? "",
      max: fields.compensation.max ?? "",
      currency: fields.compensation.currency ?? "",
      pay_period: fields.compensation.pay_period ?? "",
      basis: fields.compensation.basis ?? "",
      public_visible: fields.compensation.public_visible,
    },
    // Reference, not clone: the accepted rich JSON is never rewritten on mount.
    description: fields.description,
  };
}

/** Composes the complete write field set from raw state. Raw, not validated. */
export function composeDraftFields(state: DraftFormState): Record<string, unknown> {
  return {
    title: state.title,
    location: locationValueToWrite(state.location),
    remote_scope: state.remote_scope,
    work_mode: state.work_mode === "" ? null : state.work_mode,
    work_schedule: state.work_schedule === "" ? null : state.work_schedule,
    contract_type: state.contract_type === "" ? null : state.contract_type,
    seniority: state.seniority === "" ? null : state.seniority,
    min_years_of_experience: state.min_years_of_experience === "" ? null : state.min_years_of_experience,
    min_education_level: state.min_education_level === "" ? null : state.min_education_level,
    accepts_in_progress_education: state.accepts_in_progress_education,
    professional_area: state.professional_area === "" ? null : state.professional_area,
    required_requirements: state.required_requirements,
    preferred_requirements: state.preferred_requirements,
    skills: state.skills.map((row) => row.value),
    custom_benefits: state.custom_benefits.map((row) => row.value),
    benefits: [...state.benefits],
    screening_questions: state.screening_questions.map((row) => ({ prompt: row.value })),
    requester: composeRequester(state.requester),
    languages: state.languages.map((row) => ({
      code: row.code,
      min_level: row.min_level,
    })),
    compensation: composeCompensation(state.compensation),
    description: state.description,
  };
}

/**
 * Requester wire value: the untouched supplied value until the type is
 * explicitly changed, then exactly the visual type with its honest
 * (possibly null) id. A cleared id is never invented.
 */
function composeRequester(requester: DraftRequesterState) {
  if (!requester.changed) return requester.original;
  return { kind: requester.kind, id: requester.id };
}

/**
 * Compensation wire value: only the fields of the active mode are composed,
 * so a buffered value of an inactive control can never leak into the body and
 * can never be erased by a mode change.
 */
function composeCompensation(compensation: DraftCompensationState) {
  const mode = compensation.mode === "" ? null : compensation.mode;
  const money = (raw: string) => (raw === "" ? null : raw);
  return {
    mode,
    amount: mode === "fixed" ? money(compensation.amount) : null,
    min: mode === "range" ? money(compensation.min) : null,
    max: mode === "range" ? money(compensation.max) : null,
    currency: compensation.currency === "" ? null : compensation.currency,
    pay_period: compensation.pay_period === "" ? null : compensation.pay_period,
    basis: compensation.basis === "" ? null : compensation.basis,
    public_visible: compensation.public_visible,
  };
}

/**
 * Atomic explicit validation. The complete composed model goes through the
 * accepted full serializer once; a Zod rejection becomes precise per-field
 * errors and no model. Raw state is never mutated.
 */
export function validateDraftFormState(
  state: DraftFormState,
  baseModel: DraftModel,
): DraftValidationResult {
  const candidate: DraftModel = {
    ...baseModel,
    fields: composeDraftFields(state) as DraftModel["fields"],
    requesterName: state.requester.changed ? state.requester.name : baseModel.requesterName,
  };
  try {
    const body = draftModelToPostBody(candidate);
    return {
      ok: true,
      model: {
        ...baseModel,
        fields: body.fields,
        requesterName: candidate.requesterName,
        descriptionPlain: baseModel.descriptionPlain,
      },
    };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, errors: mapZodError(error) };
    return { ok: false, errors: { model: MODEL_ERROR } };
  }
}

/** Drops the leading `fields` segment and renders the rest as a key. */
function issueKey(path: readonly PropertyKey[]): string {
  const trimmed = path[0] === "fields" ? path.slice(1) : path;
  return trimmed.map(String).join(".");
}

/** One Zod issue → a precise, plain Spanish message for its own key. */
function issueMessage(key: string, issue: z.ZodIssue): string {
  if (key === "title") return TITLE_ERROR;
  if (key === "location" || key.startsWith("location.")) return locationErrorMessages.unknown;
  if (key.startsWith("remote_scope")) {
    if (issue.code === "too_small") return remoteScopeErrorMessages.empty;
    if (issue.code === "too_big") return remoteScopeErrorMessages.too_many;
    if (issue.message === "duplicate") return remoteScopeErrorMessages.duplicate;
    return remoteScopeErrorMessages.unknown_country;
  }
  if (key === "work_mode") return WORK_MODE_ERROR;
  if (
    key === "work_schedule" ||
    key === "contract_type" ||
    key === "seniority" ||
    key === "professional_area"
  ) {
    return ENUM_ERROR;
  }
  if (key.startsWith("required_requirements") || key.startsWith("preferred_requirements")) {
    return REQUIREMENTS_ERROR;
  }
  if (key.startsWith("skills.") || key.startsWith("custom_benefits.")) {
    if (issue.message.includes("empty after trimming")) return LIST_ITEM_EMPTY_ERROR;
    if (issue.message.includes("codepoint limit")) return LIST_ITEM_TOO_LONG_ERROR;
    if (issue.message.includes("duplicate")) return LIST_ITEM_DUPLICATE_ERROR;
    return GENERIC_ERROR;
  }
  if (key.startsWith("screening_questions.")) {
    if (issue.message.includes("empty")) return SCREENING_EMPTY_ERROR;
    if (issue.message.includes("codepoint")) return SCREENING_TOO_LONG_ERROR;
    return GENERIC_ERROR;
  }
  if (key.startsWith("benefits")) return BENEFITS_ERROR;
  if (key.startsWith("requester")) return REQUESTER_ERROR;
  if (key.startsWith("languages")) return issue.message.includes("ya está") ? issue.message : LANGUAGE_REQUIRED_ERROR;
  if (key === "min_years_of_experience") return "Usa un número de 0 a 60 con hasta un decimal, por ejemplo 1.5.";
  if (key === "min_education_level" || key === "accepts_in_progress_education") return ENUM_ERROR;
  if (key.startsWith("compensation")) {
    if (key.endsWith(".min") || key.endsWith(".max")) {
      return issue.message.includes("greater than or equal")
        ? COMPENSATION_RANGE_ERROR
        : COMPENSATION_AMOUNT_ERROR;
    }
    if (key.endsWith(".amount")) return COMPENSATION_AMOUNT_ERROR;
    return COMPENSATION_ERROR;
  }
  if (key === "description") return DESCRIPTION_ERROR;
  return GENERIC_ERROR;
}

/** All Zod issues of one atomic pass, first message per key, plus `model`. */
function mapZodError(error: ZodError): DraftFormErrors {
  const errors: DraftFormErrors = {};
  for (const issue of error.issues) {
    const rawKey = issueKey(issue.path);
    // The requester is one control; its nested id has no separate field slot.
    const key = rawKey.startsWith("requester") ? "requester" : rawKey;
    if (key === "") {
      errors.model ??= MODEL_ERROR;
      continue;
    }
    errors[key] ??= issueMessage(key, issue);
  }
  return errors;
}

/** Immutable list-row helpers. */
export function addListRow(rows: readonly DraftListRow[], prefix: string): DraftListRow[] {
  return [...rows, { id: nextRowId(prefix, rows), value: "" }];
}

export function updateListRow(
  rows: readonly DraftListRow[],
  id: string,
  value: string,
): DraftListRow[] {
  return rows.map((row) => (row.id === id ? { ...row, value } : row));
}

export function removeListRow(rows: readonly DraftListRow[], id: string): DraftListRow[] {
  return rows.filter((row) => row.id !== id);
}

/** Immutable language-row helpers; buffers survive a language change. */
export function addLanguageRow(rows: readonly DraftLanguageRow[]): DraftLanguageRow[] {
  return [
    ...rows,
    { id: nextRowId("language", rows), code: "", min_level: "" },
  ];
}

export function updateLanguageRow(
  rows: readonly DraftLanguageRow[],
  id: string,
  patch: Partial<Omit<DraftLanguageRow, "id">>,
): DraftLanguageRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export function removeLanguageRow(
  rows: readonly DraftLanguageRow[],
  id: string,
): DraftLanguageRow[] {
  return rows.filter((row) => row.id !== id);
}

/**
 * Toggles one fixed-catalog benefit. Unknown codes are ignored and the
 * submitted selection order is preserved, so no reordering or dedupe happens.
 */
export function toggleBenefit(benefits: readonly string[], code: string): string[] {
  if (!(BENEFITS as readonly string[]).includes(code)) return [...benefits];
  if (benefits.includes(code)) return benefits.filter((value) => value !== code);
  return [...benefits, code];
}

/** Immutable compensation patch; inactive buffers are retained. */
export function updateCompensation(
  state: DraftFormState,
  patch: Partial<DraftCompensationState>,
): DraftFormState {
  return { ...state, compensation: { ...state.compensation, ...patch } };
}

/** Explicit catalog selection; names are presentation-only, never wire data. */
export function selectRequester(
  state: DraftFormState,
  entry: { kind: DraftRequesterKind; id: string; name: string } | null,
): DraftFormState {
  if (entry !== null && entry.kind !== state.requester.kind) return state;
  return {
    ...state,
    requester: {
      ...state.requester,
      id: entry?.id ?? null,
      name: entry?.name ?? null,
      changed: true,
      notice: null,
    },
  };
}

/** A real type change clears the now-mismatched catalog selection. */
export function changeRequesterKind(
  state: DraftFormState,
  kind: DraftRequesterKind,
): DraftFormState {
  const requester = state.requester;
  if (requester.kind === kind) return state;
  const clearedName = requester.name;
  const hadSelection = requester.id !== null || clearedName !== null;
  const notice = hadSelection
    ? `Cambiaste el tipo de solicitante. Se quitó la selección anterior${
        clearedName === null ? "" : ` («${clearedName}»)`
      } porque pertenecía a otro tipo. Elige uno nuevo del catálogo.`
    : "Cambiaste el tipo de solicitante. Elige uno nuevo del catálogo.";
  return {
    ...state,
    requester: { ...requester, kind, id: null, name: null, changed: true, notice },
  };
}
