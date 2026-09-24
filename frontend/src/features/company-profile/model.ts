/**
 * Company-profile view model for the careers-page company. It imports nothing
 * at all, so no contract, client, transport, or form symbol can reach it, and
 * nothing here is ever persisted.
 */
/** Canonical id the prototype profile is keyed by. */
export const PROTOTYPE_COMPANY_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
/** Exact company name the existing wire vacancies already use for it. */
export const PROTOTYPE_COMPANY_SOURCE_NAME = "Acme";
/** Photographic cover plus the Spanish alternative text that conveys it. */
export type CompanyCoverPhoto = {
  readonly url: string;
  readonly alt: string;
};
/** Display-only profile: identity, Spanish narrative, and the facts a page shows. */
export type CompanyProfile = {
  readonly companyId: string;
  readonly sourceName: string;
  readonly name: string;
  readonly tagline: string;
  readonly about: string;
  readonly mission: string;
  readonly whatWeDo: string;
  readonly location: string;
  readonly companySize: string;
  readonly foundedYear: number;
  readonly website: string;
  readonly workStyle: string;
  readonly coverPhoto: CompanyCoverPhoto;
};
/** Resolves by exact id, then exact source name; any other reference is unknown. */
export function findCompanyProfile(
  profiles: readonly CompanyProfile[],
  reference: { readonly id?: string; readonly name?: string },
): CompanyProfile | undefined {
  const { id, name } = reference;
  if (id !== undefined) {
    const byId = profiles.find((profile) => profile.companyId === id);
    if (byId !== undefined) return byId;
  }
  if (name === undefined) return undefined;
  return profiles.find((profile) => profile.sourceName === name);
}
