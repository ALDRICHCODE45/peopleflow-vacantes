import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FLOATING_LINES_CONFIG,
  FLOATING_LINES_FRAGMENT_SHADER,
  FLOATING_LINES_MEDIA_QUERIES,
  FLOATING_LINES_OGL_FRAGMENT_SHADER,
  FLOATING_LINES_OGL_VERTEX_SHADER,
  FLOATING_LINES_REDUCED_MOTION_FRAME_TIME,
  FLOATING_LINES_VARIANTS,
  FLOATING_LINES_VERTEX_SHADER,
} from "./floating-lines-shaders";

// CCP-R7D2A contract: shader bytes, animation config and per-variant palettes
// are EXTRACTED from the two committed design screens on every run instead of
// duplicating literals, so drift in the module or in a reference fails with a
// diagnostic naming the offending source. Rendered-pixel fidelity is NOT
// claimed here; that belongs to the browser suite in CCP-R7D2C.

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");

function matchOrThrow(source: string, pattern: RegExp, what: string, label: string): string {
  const match = source.match(pattern);
  if (!match) throw new Error(`floating-lines parity: ${what} not found in ${label}`);
  return match[1];
}

const toHexes = (list: string) => list.split(",").map((entry) => entry.trim().replaceAll("'", ""));

/** Parses one design screen into its shader, config and palette contract. */
function parseReference(html: string, label: string) {
  const cfg = matchOrThrow(html, /const cfg = \{([^}]*)\};/, "cfg", label);
  // One literal pattern for every cfg field, so no RegExp is built from a key.
  const fields = Object.fromEntries(
    [...cfg.matchAll(/([A-Za-z]+): (\[[^\]]*\]|-?[\d.]+)/g)].map(([, key, value]) => [key, value]),
  );
  const field = (key: string) => {
    const value = fields[key];
    if (value === undefined) throw new Error(`floating-lines parity: cfg.${key} not found in ${label}`);
    return value;
  };
  return {
    label,
    vertexShader: matchOrThrow(html, /const vertexShader = `([^`]*)`;/, "vertexShader", label),
    fragmentShader: matchOrThrow(html, /const fragmentShader = `([\s\S]*?)`;/, "fragmentShader", label),
    // The panel that hosts #floatingLines gates it to desktop.
    panelClass: matchOrThrow(html, /class="([^"]*)"[^>]*>\s*<div id="floatingLines"/, "floatingLines panel class", label),
    darkGradient: toHexes(matchOrThrow(cfg, /linesGradient: \[([^\]]*)\]/, "cfg.linesGradient", label)),
    lightPalette: toHexes(matchOrThrow(html, /const lightPalette = \[([^\]]*)\];/, "lightPalette", label)),
    cfgScalar: (key: string) => Number(field(key)),
    cfgVector: (key: string) => field(key).replace(/[[\]]/g, "").split(",").map((entry) => Number(entry.trim())),
  };
}

const readReference = (file: string) => parseReference(read(`../design/screens/${file}`), `design/screens/${file}`);
const EMPLOYER = readReference("login-empresa.html");
const CANDIDATE = readReference("login-candidato.html");
const REFERENCES = [EMPLOYER, CANDIDATE] as const;
const GLOBALS_CSS = read("src/app/globals.css");
const TAILWIND_THEME = read("node_modules/tailwindcss/theme.css");
const REM_PER_PX = 16;

describe("FloatingLines reference contract (CCP-R7D2A)", () => {
  it("copies the fragment shader byte-for-byte from BOTH design sources", () => {
    for (const reference of REFERENCES) {
      expect(FLOATING_LINES_FRAGMENT_SHADER, `fragment shader drift vs ${reference.label}`).toBe(reference.fragmentShader);
    }
    expect(CANDIDATE.fragmentShader, "the two reference screens must share identical fragment bytes").toBe(EMPLOYER.fragmentShader);
  });

  it("derives the runtime OGL fragment shader with exactly one compatibility substitution", () => {
    // Chromium's GLSL ES 1.00 compiler rejects integer `min`, so the frozen
    // reference bytes cannot link there; the runtime shader substitutes that one
    // statement and changes nothing else.
    const reference = "int j=min(i+1,lineGradientCount-1);";
    const runtime = "int j=(i+1<lineGradientCount)?i+1:lineGradientCount-1;";
    expect(FLOATING_LINES_FRAGMENT_SHADER).toContain(reference);
    expect(FLOATING_LINES_OGL_FRAGMENT_SHADER).toContain(runtime);
    expect(FLOATING_LINES_OGL_FRAGMENT_SHADER).not.toContain(reference);
    // No integer `min` survives: the reference carries exactly one, the runtime none.
    expect(FLOATING_LINES_FRAGMENT_SHADER.match(/min\(/g)).toHaveLength(1);
    expect(FLOATING_LINES_OGL_FRAGMENT_SHADER).not.toContain("min(");
    // Reversing the substitution reconstructs the frozen anchor byte-for-byte.
    expect(FLOATING_LINES_OGL_FRAGMENT_SHADER.replaceAll(runtime, reference)).toBe(FLOATING_LINES_FRAGMENT_SHADER);
    // The design sources keep their own Chromium-invalid bytes: parity is untouched.
    for (const source of REFERENCES) expect(source.fragmentShader).toContain(reference);
  });

  it("exports the reference Three.js vertex shader as the exact parity anchor", () => {
    for (const reference of REFERENCES) {
      expect(FLOATING_LINES_VERTEX_SHADER, `vertex shader drift vs ${reference.label}`).toBe(reference.vertexShader);
    }
    expect(CANDIDATE.vertexShader).toBe(EMPLOYER.vertexShader);
  });

  it("ships a separate OGL vertex shader that declares its own attributes", () => {
    // OGL injects no Three built-ins, so this host shader must be self-contained.
    for (const declaration of ["attribute vec2 position;", "attribute vec2 uv;", "gl_Position = vec4(position, 0.0, 1.0);"]) {
      expect(FLOATING_LINES_OGL_VERTEX_SHADER, `OGL shader must declare ${declaration}`).toContain(declaration);
    }
    for (const threeBuiltin of ["projectionMatrix", "modelViewMatrix", "normalMatrix", "vec4(position,1.0)"]) {
      expect(FLOATING_LINES_OGL_VERTEX_SHADER, `OGL shader must not use ${threeBuiltin}`).not.toContain(threeBuiltin);
    }
    expect(FLOATING_LINES_OGL_VERTEX_SHADER).not.toBe(FLOATING_LINES_VERTEX_SHADER);
  });

  it("carries the shared config scalars and vector triples from BOTH sources", () => {
    const scalarKeys = ["animationSpeed", "lineCount", "lineDistance", "bendRadius", "bendStrength", "mouseDamping", "parallaxStrength"] as const;
    const vectorKeys = ["top", "mid", "bot"] as const;
    for (const key of scalarKeys) {
      expect(FLOATING_LINES_CONFIG[key], `cfg.${key} drift`).toBe(EMPLOYER.cfgScalar(key));
      expect(CANDIDATE.cfgScalar(key), `cfg.${key} differs between the two references`).toBe(EMPLOYER.cfgScalar(key));
    }
    for (const key of vectorKeys) {
      expect(FLOATING_LINES_CONFIG[key], `cfg.${key} vector drift`).toEqual(EMPLOYER.cfgVector(key));
      expect(CANDIDATE.cfgVector(key), `cfg.${key} differs between the two references`).toEqual(EMPLOYER.cfgVector(key));
    }
  });

  it("carries each variant's own dark gradient and light palette", () => {
    expect(FLOATING_LINES_VARIANTS.employer.darkGradient).toEqual(EMPLOYER.darkGradient);
    expect(FLOATING_LINES_VARIANTS.employer.lightPalette).toEqual(EMPLOYER.lightPalette);
    expect(FLOATING_LINES_VARIANTS.candidate.darkGradient).toEqual(CANDIDATE.darkGradient);
    expect(FLOATING_LINES_VARIANTS.candidate.lightPalette).toEqual(CANDIDATE.lightPalette);
  });

  it("keeps the two variants genuinely distinct (variant guard)", () => {
    expect(EMPLOYER.darkGradient).not.toEqual(CANDIDATE.darkGradient);
    expect(FLOATING_LINES_VARIANTS.employer.darkGradient).not.toEqual(FLOATING_LINES_VARIANTS.candidate.darkGradient);
    expect(FLOATING_LINES_VARIANTS.employer.lightPalette).not.toEqual(FLOATING_LINES_VARIANTS.candidate.lightPalette);
  });

  it("freezes the reduced-motion static frame at exactly t=4", () => {
    expect(FLOATING_LINES_REDUCED_MOTION_FRAME_TIME).toBe(4);
  });

  it("pins both media queries to their repository sources", () => {
    expect(FLOATING_LINES_MEDIA_QUERIES.reducedMotion).toBe("(prefers-reduced-motion: reduce)");
    expect(GLOBALS_CSS).toContain(`@media ${FLOATING_LINES_MEDIA_QUERIES.reducedMotion}`);
    for (const reference of REFERENCES) {
      expect(reference.panelClass, `${reference.label} panel must be mobile-hidden`).toContain("hidden");
      expect(reference.panelClass, `${reference.label} panel must be lg-gated`).toContain("lg:block");
    }
    const tailwindLgRem = TAILWIND_THEME.match(/--breakpoint-lg: ([\d.]+)rem;/)?.[1];
    expect(tailwindLgRem, "tailwindcss --breakpoint-lg is missing").toBeDefined();
    expect(FLOATING_LINES_MEDIA_QUERIES.desktop).toBe(`(min-width: ${Number(tailwindLgRem) * REM_PER_PX}px)`);
  });

  it("names the offending design source when a contract is missing", () => {
    expect(() => parseReference("<!-- shader stripped -->", "synthetic/screen.html")).toThrow(/cfg not found in synthetic\/screen\.html/);
  });
});
