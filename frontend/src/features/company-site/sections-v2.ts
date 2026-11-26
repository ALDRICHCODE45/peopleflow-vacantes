/**
 * Careers site sections v2 (slice A: new variants, team/logos/areas/talent_cta,
 * per-block `style`, hero button texts). The old backend validators are strict
 * and reject unknown keys/variants, so nothing new may be sent until backend
 * slice A is in main. This is the single switch: while it is false the draft
 * PUT body (`siteDraftPayloadSchema`) stays byte-identical to today's and the
 * editor offers none of the new controls.
 *
 * Backend slice A is in main, so it is ON by default. `NEXT_PUBLIC_CAREERS_SECTIONS_V2=false`
 * is the kill switch (Next inlines the literal access in client bundles); any other
 * value, including unset, keeps it on. The unit tests run with it off (vitest.config.ts)
 * so the pre-v2 behaviour stays pinned; the v2 tests turn it on explicitly.
 */
export const SECTIONS_V2_ENABLED: boolean = process.env.NEXT_PUBLIC_CAREERS_SECTIONS_V2 !== "false";

/**
 * «Llamado a talento» needs its public CV form (slice C). Until then the editor
 * never offers it (library), but a block that already exists in a draft is
 * edited normally. Switch on together with slice C.
 */
export const TALENT_CTA_ENABLED: boolean = false;
