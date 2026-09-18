import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LINK_PLACEHOLDER,
  applyBold,
  applyBulletList,
  applyItalic,
  applyLink,
  applyNumberedList,
  parseRichText,
  sanitizeLinkUrl,
  toPlainText,
} from "./rich-text-model";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "rich-text-model.ts"), "utf8");

describe("rich text link sanitization", () => {
  it("accepts only http and https links", () => {
    expect(sanitizeLinkUrl("https://empresa.example/vacante")).toBe(
      "https://empresa.example/vacante",
    );
    expect(sanitizeLinkUrl("http://empresa.example")).toBe(
      "http://empresa.example",
    );
    expect(sanitizeLinkUrl("  https://empresa.example  ")).toBe(
      "https://empresa.example",
    );
    // The scheme is normalized, the rest of the address is preserved.
    expect(sanitizeLinkUrl("HTTPS://Empresa.example")).toBe(
      "https://Empresa.example",
    );
  });

  it("rejects dangerous, schemeless, and malformed links", () => {
    for (const raw of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<h1>hola</h1>",
      "vbscript:msgbox(1)",
      "empresa.example",
      "mailto:rrhh@empresa.example",
      "http://",
      "https://con espacio.example",
      'https://empresa.example/"onmouseover="alert(1)',
    ]) {
      expect(sanitizeLinkUrl(raw)).toBeNull();
    }
  });

  it("rejects structurally malformed absolute http and https addresses", () => {
    for (const raw of [
      "https://)",
      "http://)",
      "https://(",
      "https://:8080",
      "https://[]",
      "https://",
      "https://%",
      "https://..",
      "https://-",
      "https://x)",
      "https://.ejemplo.com",
      "https://ejemplo..com",
      "https://?solo=query",
      "https://#fragmento",
    ]) {
      // Every one of these has a scheme but no parseable host.
      expect(sanitizeLinkUrl(raw)).toBeNull();
    }
  });

  it("keeps the lexical address with a lowercased scheme for a parseable host", () => {
    expect(sanitizeLinkUrl("https://empresa.example:8080/vacante?a=1")).toBe(
      "https://empresa.example:8080/vacante?a=1",
    );
    // The host case is preserved lexically; only the scheme is normalized.
    expect(sanitizeLinkUrl("HTTPS://Empresa.example")).toBe(
      "https://Empresa.example",
    );
  });

  it("rejects destinations the link token grammar cannot round-trip", () => {
    for (const raw of [
      "https://example.com/path)",
      "https://example.com/path(",
      "https://example.com/a)b",
      "https://example.com/a(b",
      // Nested parentheses cannot be represented by the token grammar.
      "https://example.com/a(b(c)d)",
    ]) {
      expect(sanitizeLinkUrl(raw), raw).toBeNull();
    }
  });

  it("keeps a balanced parenthesized destination the token grammar supports", () => {
    expect(sanitizeLinkUrl("https://example.com/wiki/Foo_(bar)")).toBe(
      "https://example.com/wiki/Foo_(bar)",
    );
  });
});

describe("rich text link round-trip", () => {
  it("cannot leave surplus punctuation or a raw token for an unrepresentable address", () => {
    for (const address of [
      "https://example.com/path)",
      "https://example.com/path(",
      "https://example.com/a(b(c)d)",
    ]) {
      const applied = applyLink("Mirá la guía", { start: 5, end: 12 }, address);

      // An address the token grammar cannot carry changes nothing at all.
      expect(applied.value, address).toBe("Mirá la guía");
      expect(parseRichText(applied.value), address).toEqual([
        { kind: "paragraph", spans: [{ kind: "text", text: "Mirá la guía" }] },
      ]);
      expect(toPlainText(applied.value), address).toBe("Mirá la guía");
    }
  });

  it("round-trips a balanced destination back out of the written token", () => {
    const address = "https://example.com/wiki/Foo_(bar)";
    const applied = applyLink("Mirá la guía", { start: 5, end: 12 }, address);

    expect(applied.value).toBe(
      "Mirá [la guía](https://example.com/wiki/Foo_(bar))",
    );
    expect(parseRichText(applied.value)).toEqual([
      {
        kind: "paragraph",
        spans: [
          { kind: "text", text: "Mirá " },
          { kind: "link", text: "la guía", href: address },
        ],
      },
    ]);
    // The balanced delimiter is consumed by the token, never left behind.
    expect(toPlainText(applied.value)).toBe("Mirá la guía");
    expect(toPlainText(applied.value)).not.toContain(")");
  });
});

describe("rich text parsing", () => {
  it("turns plain text into a single paragraph span", () => {
    expect(parseRichText("Describí el rol")).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "Describí el rol" }] },
    ]);
  });

  it("recognizes bold and italic tokens without emitting elements", () => {
    expect(parseRichText("hola **mundo** y *breve*")).toEqual([
      {
        kind: "paragraph",
        spans: [
          { kind: "text", text: "hola " },
          { kind: "bold", text: "mundo" },
          { kind: "text", text: " y " },
          { kind: "italic", text: "breve" },
        ],
      },
    ]);
  });

  it("groups bullet and numbered lines into their own blocks", () => {
    expect(
      parseRichText("- React\n- TypeScript\n\n1. Primero\n2. Segundo"),
    ).toEqual([
      {
        kind: "bullet-list",
        items: [[{ kind: "text", text: "React" }], [{ kind: "text", text: "TypeScript" }]],
      },
      {
        kind: "numbered-list",
        items: [[{ kind: "text", text: "Primero" }], [{ kind: "text", text: "Segundo" }]],
      },
    ]);
  });

  it("keeps the link text but nulls an unsafe href", () => {
    expect(parseRichText("[Portal](https://empresa.example)")).toEqual([
      {
        kind: "paragraph",
        spans: [
          { kind: "link", text: "Portal", href: "https://empresa.example" },
        ],
      },
    ]);
    expect(parseRichText("[Peligro](javascript:alert(1))")).toEqual([
      { kind: "paragraph", spans: [{ kind: "link", text: "Peligro", href: null }] },
    ]);
  });

  it("treats markup as literal text instead of accepting it", () => {
    expect(parseRichText("<b>hola</b>")).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "<b>hola</b>" }] },
    ]);
    expect(parseRichText('<img src=x onerror="alert(1)">')).toEqual([
      {
        kind: "paragraph",
        spans: [{ kind: "text", text: '<img src=x onerror="alert(1)">' }],
      },
    ]);
  });

  it("returns no blocks for empty content", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText("   \n  ")).toEqual([]);
  });
});

describe("rich text plain normalization", () => {
  it("resolves supported formatting and links to their text", () => {
    expect(
      toPlainText(
        "**Fuerte** experiencia con *React* y [la guía](https://empresa.example/guia)",
      ),
    ).toBe("Fuerte experiencia con React y la guía");
    // A real line break separates list items instead of one glued sentence.
    expect(toPlainText("- PostgreSQL\n- Docker")).toBe("PostgreSQL\nDocker");
    expect(toPlainText("1. Primero\n2. Segundo")).toBe("Primero\nSegundo");
  });

  it("preserves readable newlines and ordinary punctuation", () => {
    expect(toPlainText("Revisá (ver requisitos)\n100% remoto: C++ y C#")).toBe(
      "Revisá (ver requisitos)\n100% remoto: C++ y C#",
    );
    expect(toPlainText("Primer párrafo\n\nSegundo párrafo")).toBe(
      "Primer párrafo\nSegundo párrafo",
    );
    expect(toPlainText("Diseñá los servicios core.")).toBe(
      "Diseñá los servicios core.",
    );
  });

  it("neutralizes malformed and surplus formatting markers", () => {
    expect(toPlainText("**texto sin cerrar")).toBe("texto sin cerrar");
    expect(toPlainText("*suelto y **mezclado")).toBe("suelto y mezclado");
    expect(toPlainText("[texto](sin-cierre")).toBe("texto");
    expect(toPlainText("**")).toBe("");
  });

  it("preserves underscores inside words and identifiers", () => {
    expect(toPlainText("foo_bar_baz")).toBe("foo_bar_baz");
    expect(toPlainText("MY_CONST_VALUE")).toBe("MY_CONST_VALUE");
    expect(toPlainText("snake_case_value y MY_CONST")).toBe(
      "snake_case_value y MY_CONST",
    );
  });

  it("removes underscore emphasis only at non-word boundaries", () => {
    expect(toPlainText("_énfasis_")).toBe("énfasis");
    expect(toPlainText("__énfasis__")).toBe("énfasis");
    expect(toPlainText("texto _énfasis_ final")).toBe("texto énfasis final");
    expect(toPlainText("__nota__ y _breve_")).toBe("nota y breve");
    // A word-internal pair is not emphasis and must survive intact.
    expect(toPlainText("prefijo_uno_dos")).toBe("prefijo_uno_dos");
  });

  it("never leaves surplus punctuation when an invalid link address is applied", () => {
    const applied = applyLink("Mirá la guía", { start: 5, end: 12 }, "https://)");

    // A structurally invalid address cannot enter the value at all, so no
    // surplus ")" can reach the plain public projection.
    expect(applied.value).toBe("Mirá la guía");
    expect(toPlainText(applied.value)).toBe("Mirá la guía");
    expect(toPlainText(applied.value)).not.toContain(")");
  });
});

describe("rich text selection formatting", () => {
  it("wraps the selected text in bold and selects it again", () => {
    expect(applyBold("hola mundo", { start: 0, end: 4 })).toEqual({
      value: "**hola** mundo",
      selection: { start: 2, end: 6 },
    });
  });

  it("inserts a bold placeholder when nothing is selected", () => {
    const edit = applyBold("hola", { start: 5, end: 5 });

    expect(edit.value).toBe("hola **texto en negrita**");
    expect(edit.selection).toEqual({ start: 7, end: 23 });
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe(
      "texto en negrita",
    );
  });

  it("wraps the selection in italic and keeps every unselected character", () => {
    const edit = applyItalic("uno dos tres", { start: 4, end: 7 });

    expect(edit.value).toBe("uno *dos* tres");
    expect(edit.selection).toEqual({ start: 5, end: 8 });
  });

  it("spaces a collapsed placeholder away from the neighbouring word", () => {
    const edit = applyItalic("hola mundo", { start: 4, end: 4 });

    expect(edit.value).toBe("hola *texto en cursiva* mundo");
    expect(edit.selection).toEqual({ start: 6, end: 22 });
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe(
      "texto en cursiva",
    );

    // An empty value needs no padding at all.
    expect(applyBold("", { start: 0, end: 0 })).toEqual({
      value: "**texto en negrita**",
      selection: { start: 2, end: 18 },
    });
  });

  it("clamps and orders the incoming range", () => {
    expect(applyBold("hola", { start: 9, end: 12 })).toEqual(
      applyBold("hola", { start: 4, end: 4 }),
    );
    expect(applyBold("hola mundo", { start: 4, end: 0 }).value).toBe(
      "**hola** mundo",
    );
  });

  it("prefixes every touched line with a bullet and leaves the rest untouched", () => {
    const edit = applyBulletList("Primero\nSegundo\nTercero", {
      start: 0,
      end: 14,
    });

    expect(edit.value).toBe("- Primero\n- Segundo\nTercero");
    expect(edit.selection).toEqual({ start: 0, end: 19 });
  });

  it("applies a bullet to the caret line when the selection is collapsed", () => {
    expect(applyBulletList("uno\ndos", { start: 5, end: 5 }).value).toBe(
      "uno\n- dos",
    );
    // An already-marked line is left exactly as it was.
    expect(applyBulletList("- uno", { start: 0, end: 5 }).value).toBe("- uno");
  });

  it("numbers each touched line from one", () => {
    expect(applyNumberedList("uno\ndos\ntres", { start: 0, end: 7 }).value).toBe(
      "1. uno\n2. dos\ntres",
    );
  });

  it("wraps the selection in a sanitized link token", () => {
    const edit = applyLink("Mirá la guía", { start: 5, end: 12 }, "https://empresa.example/guia");

    expect(edit.value).toBe("Mirá [la guía](https://empresa.example/guia)");
    expect(edit.selection).toEqual({ start: 6, end: 13 });
  });

  it("inserts a placeholder label when no text is selected", () => {
    const edit = applyLink("", { start: 0, end: 0 }, "https://empresa.example/guia");

    expect(edit.value).toBe(`[${LINK_PLACEHOLDER}](https://empresa.example/guia)`);
    expect(edit.value.slice(edit.selection.start, edit.selection.end)).toBe(
      LINK_PLACEHOLDER,
    );
  });

  it("leaves the value unchanged for an unsafe link", () => {
    const edit = applyLink("Mirá la guía", { start: 5, end: 12 }, "javascript:alert(1)");

    expect(edit.value).toBe("Mirá la guía");
    expect(edit.selection).toEqual({ start: 5, end: 12 });
  });
});

describe("rich text model source boundary", () => {
  it("stays a pure module without imports or a markup escape hatch", () => {
    expect(source).not.toMatch(/^import\s/mu);
    for (const forbidden of [
      "innerHTML",
      "dangerouslySetInnerHTML",
      "contentEditable",
      "execCommand",
      "document.",
      "window.",
      "React",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("cannot reach the request contract or the network layer", () => {
    expect(source).not.toMatch(/createJob|requestJson|\bfetch\b|schemas|zod/);
  });
});
