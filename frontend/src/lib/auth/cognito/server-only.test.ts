import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src/lib/auth/cognito");
const modules = readdirSync(DIR).filter((file) => /\.ts$/.test(file) && !/\.test\.ts$/.test(file));

describe("cognito module boundary", () => {
  it("has the expected production modules", () => {
    expect(modules.sort()).toEqual(["client.ts", "config.ts", "errors.ts", "index.ts", "secret-hash.ts", "transport.ts"]);
  });

  it.each(modules)("%s is server-only and never logs", (file) => {
    const source = readFileSync(join(DIR, file), "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source).not.toMatch(/\bconsole\./);
  });

  it("is reachable only from server code (no client component imports it)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const source = readFileSync(full, "utf8");
          if (/^["']use client["']/.test(source.trimStart()) && /lib\/auth\/cognito/.test(source)) offenders.push(full);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
