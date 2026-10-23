import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// A chips combobox must anchor its popup to the whole chips box; otherwise Base UI
// positions it against the inner text input and it opens shifted and narrower.
const root = join(__dirname, "../..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.tsx$/u.test(name) && !/\.test\.tsx$/u.test(name) ? [path] : [];
  });
}

it("anchors every chips combobox popup to its chips box", () => {
  const offenders = sources(root).filter(path => {
    const source = readFileSync(path, "utf8");
    if (!source.includes("<ComboboxChips") || path.endsWith("components/ui/combobox.tsx")) return false;
    const chips = source.match(/<ComboboxChips\b[^>]*>/gu) ?? [];
    const contents = source.match(/<ComboboxContent\b[^>]*>/gu) ?? [];
    return !chips.every(tag => /ref=\{\w+\}/u.test(tag)) || !contents.every(tag => /anchor=\{\w+\}/u.test(tag));
  }).map(path => relative(root, path));
  expect(offenders).toEqual([]);
});
