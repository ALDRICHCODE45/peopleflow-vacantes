import {
  PROTOTYPE_COMPANY_ID,
  PROTOTYPE_COMPANY_SOURCE_NAME,
  type CompanyProfile,
} from "./model";
/**
 * The one company the careers page renders: a Mexican B2B logistics and
 * operations technology firm. The website uses the RFC 2606 reserved `.example`
 * domain, so the page can never point at a real company, and no customer,
 * performance, or verification metric is claimed. The cover is a self-hosted
 * public-domain photograph; its source, creator, license, and transformation
 * live beside the file in `public/company/acme-cover.PROVENANCE.txt`.
 */
const ACME_PROFILE: CompanyProfile = {
  companyId: PROTOTYPE_COMPANY_ID,
  sourceName: PROTOTYPE_COMPANY_SOURCE_NAME,
  name: "Acme",
  tagline: "Tecnología de operaciones para mover carga en México.",
  about: "Acme es una empresa de tecnología para logística y operaciones. Ayuda a equipos de almacén y transporte a planear rutas, seguir embarques y coordinar inventario entre bodegas.",
  mission: "Simplificar la operación diaria de quien mueve carga, con herramientas claras y datos que el equipo pueda revisar.",
  whatWeDo: "Diseñamos software de planeación de rutas, seguimiento de embarques y control de inventario para operaciones logísticas en México.",
  location: "Monterrey, Nuevo León, México",
  companySize: "201 a 500 personas",
  foundedYear: 2016,
  website: "https://acme-logistica.example",
  workStyle: "Híbrido: tres días en oficina y dos remotos.",
  coverPhoto: { url: "/company/acme-cover.webp", alt: "Trabajadores operando montacargas entre tarimas con suministros dentro de un almacén grande." },
};
/** Freezes the profile and the nested blocks a page renders. */
function freezeProfile(profile: CompanyProfile): CompanyProfile {
  return Object.freeze({
    ...profile,
    coverPhoto: Object.freeze({ ...profile.coverPhoto }),
  });
}
/** The Acme profile, frozen for display. */
export const ACME_PROTOTYPE_PROFILE: CompanyProfile = freezeProfile(ACME_PROFILE);
/** Every prototype profile the careers pages can resolve, in display order. */
export const PROTOTYPE_COMPANY_PROFILES: readonly CompanyProfile[] = Object.freeze(
  [ACME_PROTOTYPE_PROFILE],
);
