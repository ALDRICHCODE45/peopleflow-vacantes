import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const frontendRoot = process.cwd();

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(frontendRoot, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

describe("shadcn preset b27M1Ev2 identity invariants", () => {
  it("keeps components.json on the exact decoded preset configuration", () => {
    const componentsJson = readJson("components.json");

    expect(componentsJson.style).toBe("base-rhea"); // Rhea style, Base UI
    expect((componentsJson.tailwind as Record<string, unknown>).baseColor).toBe(
      "neutral",
    ); // Neutral base
    expect((componentsJson.tailwind as Record<string, unknown>).css).toBe(
      "src/app/globals.css",
    );
    expect(
      (componentsJson.tailwind as Record<string, unknown>).cssVariables,
    ).toBe(true);
    expect(componentsJson.iconLibrary).toBe("lucide");
    expect(componentsJson.rsc).toBe(true);
    expect(componentsJson.menuColor).toBe("default");
    expect(componentsJson.menuAccent).toBe("subtle");

    const aliases = componentsJson.aliases as Record<string, string>;
    expect(aliases.components).toBe("@/components");
    expect(aliases.ui).toBe("@/components/ui");
  });

  it("keeps the TypeScript alias mapped to the src directory", () => {
    const tsconfig = readJson("tsconfig.json");
    const paths = (tsconfig.compilerOptions as Record<string, unknown>)
      .paths as Record<string, string[]>;
    expect(paths["@/*"]).toEqual(["./src/*"]);
  });

  it("keeps product compositions out of the CLI-managed ui directory", () => {
    const uiDir = join(frontendRoot, "src/components/ui");
    if (!existsSync(uiDir)) return;

    const forbidden = /shell|brand|jobs|marketing|feature/i;
    const names = readdirSync(uiDir, { recursive: true }).map(String);
    for (const name of names) {
      expect(
        forbidden.test(name),
        `${name} must not live under src/components/ui`,
      ).toBe(false);
    }
  });

  it("keeps Tailwind CSS v4 as the styling runtime", () => {
    const pkg = readJson("package.json");
    const deps = {
      ...(pkg.dependencies as Record<string, string>),
      ...(pkg.devDependencies as Record<string, string>),
    };
    expect(deps.tailwindcss).toMatch(/^4\./);
    expect(deps["@tailwindcss/postcss"]).toMatch(/^4\./);
  });

  it("keeps Lucide as the only icon family", () => {
    const pkg = readJson("package.json");
    const deps = {
      ...(pkg.dependencies as Record<string, string>),
      ...(pkg.devDependencies as Record<string, string>),
    };
    expect(deps["lucide-react"]).toEqual(expect.any(String));
    const competingIconPackages = Object.keys(deps).filter((name) =>
      /@icons|iconify|heroicons|tabler|phosphor|feather-icons|react-icons/.test(
        name,
      ),
    );
    expect(competingIconPackages).toEqual([]);
  });
});
