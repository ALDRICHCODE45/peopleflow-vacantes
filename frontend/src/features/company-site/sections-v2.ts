/**
 * Careers site sections v2 (slice A: new variants, team/logos/areas/talent_cta,
 * per-block `style`, hero button texts). The old backend validators are strict
 * and reject unknown keys/variants, so nothing new may be sent until backend
 * slice A is in main. This is the single switch: while it is false the draft
 * PUT body (`siteDraftPayloadSchema`) stays byte-identical to today's.
 */
export const SECTIONS_V2_ENABLED: boolean = false;
