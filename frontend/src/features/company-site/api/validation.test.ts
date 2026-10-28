import { expect, it } from "vitest";
import { defaultSiteDraft } from "../defaults";
import { siteDraftSchema } from "../model";
import { draftFieldErrors } from "./validation";

it.each(["accent_color", "background_color"])("maps malformed %s to the backend invalid field code", key => {
  for (const value of ["#123", " #abcdef ", false, 123]) {
    const draft = defaultSiteDraft();
    const parsed = siteDraftSchema.safeParse({ ...draft, theme: { ...draft.theme, [key]: value } });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(draftFieldErrors(parsed.error.issues)).toEqual([{ field: `theme.${key}`, code: "invalid" }]);
  }
});
