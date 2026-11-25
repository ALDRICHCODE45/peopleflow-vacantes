/**
 * Careers site sections v2 (slice A: new variants, team/logos/areas/talent_cta,
 * per-block `style`, hero button texts). The old backend validators are strict
 * and reject unknown keys/variants, so nothing new may be sent until backend
 * slice A is in main. This is the single switch: while it is false the draft
 * PUT body (`siteDraftPayloadSchema`) stays byte-identical to today's and the
 * editor offers none of the new controls.
 *
 * Read from the public build env so a local browser check can turn it on
 * (`NEXT_PUBLIC_CAREERS_SECTIONS_V2=true`); Next inlines the literal access in
 * client bundles. Anything else, including unset, keeps it off.
 */
export const SECTIONS_V2_ENABLED: boolean = process.env.NEXT_PUBLIC_CAREERS_SECTIONS_V2 === "true";

/**
 * «Llamado a talento» needs its public CV form (slice C). Until then the editor
 * never offers it (library), but a block that already exists in a draft is
 * edited normally. Switch on together with slice C.
 */
export const TALENT_CTA_ENABLED: boolean = false;
