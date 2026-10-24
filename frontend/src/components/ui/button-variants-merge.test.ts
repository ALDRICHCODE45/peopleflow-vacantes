import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// `buttonVariants({ variant: "outline", className })` on a plain element is not
// twMerged: the base `border-transparent` beats the outline `border-border`, so
// the link renders without a border. Outline links must merge through `cn(...)`
// (or use <Button render={...}>).
const root = join(process.cwd(), "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

it("merges every outline buttonVariants call through cn", () => {
  const offenders = sources(root).flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        /buttonVariants\(\{[^}]*variant:\s*"outline"/.test(line) && !/cn\(\s*buttonVariants\(/.test(line)
          ? [`${relative(root, path)}:${index + 1}`]
          : [],
      ),
  );
  expect(offenders).toEqual([]);
});
