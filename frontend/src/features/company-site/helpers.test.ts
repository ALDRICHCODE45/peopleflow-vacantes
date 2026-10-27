import { expect, it } from "vitest";
import { slugFromName, validateSlug } from "./slug";
import { parseVideoUrl } from "./video";
import { adjustedBrandColor, contrastRatio, readableOn, FONT_PAIRS } from "./brand";

it.each([["Nexo Labs", "nexo-labs"], ["Café & Co. México", "cafe-co-mexico"], [" -- Hola___mundo -- ", "hola-mundo"], ["😀", ""], [`${"a".repeat(50)} otra-palabra-larga`, `${"a".repeat(50)}-otra`], ["a".repeat(70), "a".repeat(60)]])("slugFromName(%s)", (input, expected) => expect(slugFromName(input)).toBe(expected));
it.each(["admin", "api", "empresa", "empresas", "vacantes", "candidato", "login", "nuevo", "nueva", "peopleflow", "soporte", "ayuda"])("reserved slug %s", slug => expect(validateSlug(slug)).toBe("reserved"));
it.each(["ab", "a".repeat(61), "Uppercase", "a--b", "-abc", "abc-", "a_b", "café", " abc"])("invalid slug %s", slug => expect(validateSlug(slug)).toBe("invalid"));
it.each(["abc", "a".repeat(60), "nexo-labs", "123"])("valid slug %s", slug => expect(validateSlug(slug)).toBeNull());
it.each([
  ["https://youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12", "youtube", "dQw4w9WgXcQ"],
  ["https://youtu.be/dQw4w9WgXcQ?t=2", "youtube", "dQw4w9WgXcQ"],
  ["https://youtube.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
  ["https://youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
  ["https://vimeo.com/123", "vimeo", "123"], ["https://www.vimeo.com/123456789012", "vimeo", "123456789012"],
  ["https://player.vimeo.com/video/123", "vimeo", "123"],
])("parse %s", (url, provider, video_id) => expect(parseVideoUrl(url)).toEqual({ provider, video_id }));
it.each(["", "bad", "javascript:alert(1)", "https://evil.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ", "https://evil.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com@evil.com/watch?v=dQw4w9WgXcQ", "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=short", "https://youtu.be/dQw4w9WgXcQ/extra", "https://youtube.com/watch", "https://vimeo.com/abc", "https://vimeo.com/1234567890123", "https://player.vimeo.com/123", "https://vimeo.com/123/extra", "https://youtube.com:444/watch?v=dQw4w9WgXcQ", "ftp://youtube.com/watch?v=dQw4w9WgXcQ"])("reject video %s", url => expect(parseVideoUrl(url)).toBeNull());
it("WCAG relative luminance and readable foreground", () => {
  expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21);
  expect(contrastRatio("#123456", "#123456")).toBe(1);
  expect(contrastRatio("#FFFFFF", "#7835DB")).toBeGreaterThanOrEqual(4.5);
  expect(readableOn("#7835DB")).toBe("#FFFFFF");
  expect(readableOn("#FFFFAA")).toBe("#000000");
  expect(contrastRatio("#abcdef", "#ffffff")).toBe(contrastRatio("#FFFFFF", "#ABCDEF"));
});
it.each([["#FFFFAA", "#FFFFFF"], ["#123456", "#000000"], ["#777777", "#777777"]])("adjusts %s on %s to at least 4.5", (color, bg) => {
  const result = adjustedBrandColor(color, bg);
  expect(result.adjusted).toBe(true);
  expect(contrastRatio(result.color, bg)).toBeGreaterThanOrEqual(4.5);
});
it("preserves an already-readable brand and exposes three curated pairs", () => {
  expect(adjustedBrandColor("#7835DB", "#FFFFFF")).toEqual({ color: "#7835DB", adjusted: false });
  expect(Object.keys(FONT_PAIRS)).toEqual(["classic", "editorial", "modern"]);
  expect(Object.values(FONT_PAIRS).map(p => p.label)).toEqual(["Clásica", "Editorial", "Moderna"]);
});
