import { describe, expect, it } from "vitest";
import { collapseUnicodeWhiteSpace, trimUnicodeWhiteSpace } from "./text";

describe("shared Unicode whitespace helpers", () => {
  it("collapses runs without trimming or applying NFC/casefold", () => {
    expect(collapseUnicodeWhiteSpace("\t A\u0301\u00a0\u2003B\n")).toBe(" A\u0301 B ");
  });

  it("keeps the existing trim-only behavior, including interior whitespace and NFD", () => {
    expect(trimUnicodeWhiteSpace("\t A\u0301\u00a0  \tB\u3000")).toBe("A\u0301\u00a0  \tB");
    expect(trimUnicodeWhiteSpace("\u0085\u2000\u2028\u202f")).toBe("");
  });

  it("never treats FEFF or zero-width characters as whitespace", () => {
    for (const helper of [collapseUnicodeWhiteSpace, trimUnicodeWhiteSpace]) {
      expect(helper("\ufeff\u200b A\u200b\ufeff")).toBe("\ufeff\u200b A\u200b\ufeff");
    }
  });
});
