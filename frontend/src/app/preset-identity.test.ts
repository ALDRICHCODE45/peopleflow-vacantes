import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertUiPrimitiveInventory } from "../../tests/support/assert-ui-primitive-inventory";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const frontendRoot = process.cwd();
const requiredUiPrimitives = [
  "button",
  "empty",
  "field",
  "input",
  "label",
  "select",
  "separator",
  "sheet",
] as const;

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(frontendRoot, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

function withUiInventory(
  primitiveNames: readonly string[] | undefined,
  assertion: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "peopleflow-ui-inventory-"));
  try {
    if (primitiveNames) {
      const uiDir = join(root, "src", "components", "ui");
      mkdirSync(uiDir, { recursive: true });
      for (const name of primitiveNames)
        writeFileSync(join(uiDir, `${name}.tsx`), "");
    }
    assertion(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
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

  it("requires the CLI-managed UI directory to exist", () => {
    withUiInventory(undefined, (root) => {
      expect(() => assertUiPrimitiveInventory(root)).toThrow(
        /src\/components\/ui must exist/,
      );
    });
  });

  it("rejects an empty CLI-managed UI directory", () => {
    withUiInventory([], (root) => {
      expect(() => assertUiPrimitiveInventory(root)).toThrow(
        /missing required primitives: button/,
      );
    });
  });

  it("rejects an incomplete CLI-managed UI directory", () => {
    withUiInventory(requiredUiPrimitives.slice(0, -1), (root) => {
      expect(() => assertUiPrimitiveInventory(root)).toThrow(
        /missing required primitives: sheet/,
      );
    });
  });

  it("rejects product compositions under the CLI-managed UI directory", () => {
    withUiInventory([...requiredUiPrimitives, "jobs-card"], (root) => {
      expect(() => assertUiPrimitiveInventory(root)).toThrow(
        /jobs-card\.tsx must not live under src\/components\/ui/,
      );
    });
  });

  it("allows additional generic UI primitives", () => {
    withUiInventory([...requiredUiPrimitives, "tooltip"], (root) => {
      expect(() => assertUiPrimitiveInventory(root)).not.toThrow();
    });
  });

  it("keeps the installed UI primitive inventory generic and complete", () => {
    assertUiPrimitiveInventory(frontendRoot);
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

  it("keeps Lucide as the general icon family and only the intentional Tabler dashboard family", () => {
    const pkg = readJson("package.json");
    const deps = {
      ...(pkg.dependencies as Record<string, string>),
      ...(pkg.devDependencies as Record<string, string>),
    };
    // Lucide remains the preset/global family (components.json iconLibrary);
    // the employer dashboard block intentionally adopts Tabler, so that single
    // package is required here instead of competing with Lucide.
    expect(deps["lucide-react"]).toEqual(expect.any(String));
    expect(deps["@tabler/icons-react"]).toEqual(expect.any(String));
    const competingIconPackages = Object.keys(deps).filter(
      (name) =>
        /@icons|iconify|heroicons|tabler|phosphor|feather-icons|react-icons/.test(
          name,
        ) && name !== "@tabler/icons-react",
    );
    expect(competingIconPackages).toEqual([]);
  });
});
