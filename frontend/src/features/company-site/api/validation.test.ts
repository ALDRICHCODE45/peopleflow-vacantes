import { expect, it } from "vitest";
import { defaultSiteDraft } from "../defaults";
import { createSiteDraftPayloadSchema, siteDraftSchema } from "../model";
import { PROFESSIONAL_AREAS } from "../../jobs/drafts/scalars";
import { draftFieldErrors } from "./validation";

it.each(["accent_color", "background_color"])("maps malformed %s to the backend invalid field code", key => {
  for (const value of ["#123", " #abcdef ", false, 123]) {
    const draft = defaultSiteDraft();
    const parsed = siteDraftSchema.safeParse({ ...draft, theme: { ...draft.theme, [key]: value } });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(draftFieldErrors(parsed.error.issues)).toEqual([{ field: `theme.${key}`, code: "invalid" }]);
  }
});

// Sections v2 field paths: each control owns its own path instead of collapsing to `blocks[i]`.
const heroId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d10";
const jobsId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d11";
const v2Draft = (hero: Record<string, unknown> = {}, extra: Record<string, unknown>[] = []) => ({
  ...defaultSiteDraft(),
  blocks: [
    { id: heroId, type: "hero", variant: "photo", hidden: false, content: { title: null, subtitle: null, cover: null, ...hero } },
    { id: jobsId, type: "jobs", variant: "list", hidden: false, content: { title: null, intro: null } },
    ...extra,
  ],
});
const issuesOf = (value: unknown, enabled: boolean) => {
  const parsed = createSiteDraftPayloadSchema(enabled).safeParse(value);
  return parsed.success ? [] : draftFieldErrors(parsed.error.issues);
};
it("keeps style keys as their own field paths", () => {
  const draft = v2Draft();
  (draft.blocks[1] as Record<string, unknown>).style = { background: "brand", spacing: "airy", align: "start", overlay: "soft", image: null };
  expect(issuesOf(draft, true)).toEqual([{ field: "blocks[1].style.overlay", code: "not_allowed" }]);
});
it("refuses a non-default style with the flag off at the style path", () => {
  const draft = v2Draft();
  (draft.blocks[1] as Record<string, unknown>).style = { background: "tint", spacing: "airy", align: "start", overlay: null, image: null };
  expect(issuesOf(draft, false)).toEqual([{ field: "blocks[1].style", code: "not_allowed" }]);
});
it("maps collage images, hero button texts and the secondary target to their controls", () => {
  expect(issuesOf(v2Draft({ images: [{ media_id: "nope" }] }), true)).toEqual([{ field: "blocks[0].content.images[0]", code: "invalid" }]);
  expect(issuesOf(v2Draft({ primary_label: "x".repeat(25) }), true)).toEqual([{ field: "blocks[0].content.primary_label", code: "too_long" }]);
  expect(issuesOf(v2Draft({ secondary_target: heroId }), true)).toEqual([{ field: "blocks[0].content.secondary_target", code: "invalid" }]);
});
it("maps area overrides per item, including duplicate keys", () => {
  const areas = (overrides: unknown[]) => ({ id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d12", type: "areas", variant: "icon_cards", hidden: false, content: { title: null, intro: null, overrides } });
  expect(issuesOf(v2Draft({}, [areas([{ key: PROFESSIONAL_AREAS[0], icon: "heart", photo: null }, { key: PROFESSIONAL_AREAS[0], icon: "star", photo: null }])]), true))
    .toEqual([{ field: "blocks[2].content.overrides[1].key", code: "duplicate" }]);
  expect(issuesOf(v2Draft({}, [areas([{ key: PROFESSIONAL_AREAS[0], icon: null, photo: null }])]), true))
    .toEqual([{ field: "blocks[2].content.overrides[0].icon", code: "required" }]);
});
