import type { CompanyCoverPhoto, CompanyProfile } from "./model";

/**
 * Presentation-only company content the shared careers renderer paints. It is
 * derived from the approved public profile (or supplied by an editor preview),
 * so every narrative and fact is optional: a company without an approved story,
 * cover, or fact sheet renders an honest identity-only draft instead of
 * borrowing another company's content. Nothing here is persisted, fetched, or
 * part of the route contract; `CompanyProfile` and `findCompanyProfile` stay
 * untouched and keep their exact, fixture-tested contract.
 */
export type CompanySiteContent = {
  readonly name: string;
  readonly tagline?: string;
  readonly about?: string;
  readonly mission?: string;
  readonly whatWeDo?: string;
  readonly location?: string;
  readonly companySize?: string;
  readonly foundedYear?: number;
  readonly website?: string;
  readonly workStyle?: string;
  readonly coverPhoto?: CompanyCoverPhoto;
};

/**
 * Copies the approved profile into the renderer's presentation contract, field
 * by field. It reads the profile and never writes to it, so the public fixture
 * stays frozen and the route keeps resolving it through `findCompanyProfile`.
 */
export function siteContentFromProfile(profile: CompanyProfile): CompanySiteContent {
  return {
    name: profile.name,
    tagline: profile.tagline,
    about: profile.about,
    mission: profile.mission,
    whatWeDo: profile.whatWeDo,
    location: profile.location,
    companySize: profile.companySize,
    foundedYear: profile.foundedYear,
    website: profile.website,
    workStyle: profile.workStyle,
    coverPhoto: profile.coverPhoto,
  };
}

/**
 * Honest empty draft: the identity of a company with no approved story, cover,
 * or facts. Every unapproved field is absent, never filled with another
 * company's content, so a preview shows exactly what has been authored.
 */
export function emptyCompanySiteContent(name: string): CompanySiteContent {
  return { name };
}

/**
 * Base heading level a host page gives the renderer: `1` on the public route
 * (name as the document H1) and `2` when embedded in an editor preview that
 * owns its own H1, which promotes the name to H2 and the sections to H3.
 */
export type CompanySiteHeadingLevel = 1 | 2;

/** Resolved tag names and anchor ids so two renderers never share an id or landmark. */
export type CompanySiteHeadings = {
  readonly nameTag: "h1" | "h2";
  readonly sectionTag: "h2" | "h3";
  readonly nameId: string;
  readonly storyId: string;
  readonly capabilitiesId: string;
  readonly jobsId: string;
};

/**
 * Maps a base level plus an optional id prefix to the renderer's heading tags
 * and anchors. The `sobre-empresa`/`vacantes` suffix survives the prefix, so a
 * preview can derive its own anchors without colliding with the public page.
 */
export function companySiteHeadings(level: CompanySiteHeadingLevel = 1, idPrefix = ""): CompanySiteHeadings {
  const nameTag: "h1" | "h2" = level === 2 ? "h2" : "h1";
  const sectionTag: "h2" | "h3" = level === 2 ? "h3" : "h2";
  return {
    nameTag,
    sectionTag,
    nameId: `${idPrefix}empresa`,
    storyId: `${idPrefix}sobre-empresa`,
    capabilitiesId: `${idPrefix}que-hacemos`,
    jobsId: `${idPrefix}vacantes`,
  };
}
