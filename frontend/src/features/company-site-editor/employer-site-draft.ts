import {
  emptyCompanySiteContent,
  type CompanySiteContent,
} from "@/features/company-profile/company-site-content";

/**
 * Employer identity the local site editor starts from.
 *
 * The employer workspace already names its fictional company "Nexo Labs" in
 * `components/company-dashboard/app-sidebar.tsx`, but that module is a client
 * component and exports no identity constant, so the editor declares the same
 * employer name here instead of importing a whole component module. It stays a
 * name only: the draft starts from `emptyCompanySiteContent`, so no other
 * company's fact, cover photo, metric, benefit or credential can reach it.
 */
export const EMPLOYER_SITE_IDENTITY_NAME = "Nexo Labs";

/**
 * Every editable field of the local site editor, in section order.
 *
 * Only identity (name, tagline), story (about, mission) and capabilities
 * (whatWeDo) are editable. Every other fact of the shared presentation contract
 * — location, team size, founded year, website, work style, cover — stays
 * optional and unauthored, so the preview shows exactly what a person wrote.
 */
export type EmployerSiteDraft = {
  readonly name: string;
  readonly tagline: string;
  readonly about: string;
  readonly mission: string;
  readonly whatWeDo: string;
};

/** One editable field key, so a single local updater can replace any of them. */
export type EmployerSiteField = keyof EmployerSiteDraft;

/** Identity-only starting draft: the employer name with every story field empty. */
export function createEmployerSiteDraft(): EmployerSiteDraft {
  return {
    name: EMPLOYER_SITE_IDENTITY_NAME,
    tagline: "",
    about: "",
    mission: "",
    whatWeDo: "",
  };
}

/** True when a typed field carries content instead of only whitespace. */
function declared(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Maps the local draft onto the renderer's presentation contract.
 *
 * A field the editor has not authored is omitted instead of sent as an empty
 * string, so the preview keeps rendering the renderer's honest "no story yet"
 * placeholder rather than an empty paragraph. The name falls back to the
 * employer identity when the field is blank, because the preview must never
 * paint an empty company heading or lose the identity it started from.
 */
export function draftToSiteContent(draft: EmployerSiteDraft): CompanySiteContent {
  return {
    ...emptyCompanySiteContent(
      declared(draft.name) ? draft.name : EMPLOYER_SITE_IDENTITY_NAME,
    ),
    ...(declared(draft.tagline) ? { tagline: draft.tagline } : {}),
    ...(declared(draft.about) ? { about: draft.about } : {}),
    ...(declared(draft.mission) ? { mission: draft.mission } : {}),
    ...(declared(draft.whatWeDo) ? { whatWeDo: draft.whatWeDo } : {}),
  };
}

/**
 * Immutable single-field update: the editor never mutates the previous draft,
 * and the typed value is kept verbatim so the input and the preview agree.
 */
export function updateDraftField(
  draft: EmployerSiteDraft,
  field: EmployerSiteField,
  value: string,
): EmployerSiteDraft {
  const next: Record<EmployerSiteField, string> = { ...draft, [field]: value };
  return next;
}
