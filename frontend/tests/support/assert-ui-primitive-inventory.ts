import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

const REQUIRED_UI_PRIMITIVES = [
  "button",
  "empty",
  "field",
  "input",
  "label",
  "select",
  "separator",
  "sheet",
] as const;
const PRODUCT_COMPONENT_PATTERN = /shell|brand|jobs|marketing|feature/i;

/** Asserts the CLI-managed UI inventory required by the public frontend tests. */
export function assertUiPrimitiveInventory(frontendRoot: string): void {
  const uiDir = join(frontendRoot, "src", "components", "ui");
  assert.ok(
    existsSync(uiDir) && statSync(uiDir).isDirectory(),
    "src/components/ui must exist",
  );

  const entries = readdirSync(uiDir, { recursive: true }).map(String);
  const primitiveNames = new Set(
    entries.map((entry) => basename(entry, extname(entry))),
  );
  const missing = REQUIRED_UI_PRIMITIVES.filter(
    (primitive) => !primitiveNames.has(primitive),
  );

  assert.deepEqual(
    missing,
    [],
    `missing required primitives: ${missing.join(", ")}`,
  );
  for (const entry of entries)
    assert.ok(
      !PRODUCT_COMPONENT_PATTERN.test(entry),
      `${entry} must not live under src/components/ui`,
    );
}
