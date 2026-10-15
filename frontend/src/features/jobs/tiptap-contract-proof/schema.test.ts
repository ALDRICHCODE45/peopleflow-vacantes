import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Editor, JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  FONT_SIZE_PRESETS,
  SCHEMA_VERSION,
  TIPTAP_PACKAGE_VERSIONS,
  createProofEditor,
  isSafeExternalHref,
  toPlainText,
} from "./schema";
import type { FontSizePreset } from "./schema";

const PROOF_DIR = join(process.cwd(), "src", "features", "jobs", "tiptap-contract-proof");
const FIXTURE_PATH = join(PROOF_DIR, "fixtures", "tiptap-draft-contract.fixtures.json");

const live: Editor[] = [];
const open = (content?: JSONContent): Editor => {
  const instance = createProofEditor(content);
  live.push(instance);
  return instance;
};
afterEach(() => {
  while (live.length > 0) live.pop()?.destroy();
});

type Mark = NonNullable<JSONContent["marks"]>[number];
const txt = (text: string, marks?: Mark[]): JSONContent => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const block = (type: string, attrs?: Mark["attrs"], content?: JSONContent[], marks?: Mark[]): JSONContent => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content ? { content } : {}),
  ...(marks ? { marks } : {}),
});
const p = (...content: JSONContent[]): JSONContent => block("paragraph", undefined, content.length ? content : undefined);
const li = (...content: JSONContent[]): JSONContent => block("listItem", undefined, content);
const doc = (...content: JSONContent[]): JSONContent => block("doc", undefined, content);
const size = (preset: FontSizePreset): Mark => ({ type: "fontSizePreset", attrs: { preset } });
const marksOf = (instance: Editor) => instance.getJSON().content?.[0]?.content?.[0]?.marks;
const LINK_DEFAULTS = { target: "_blank", rel: "noopener noreferrer nofollow", class: null, title: null };

describe("fontSizePreset mark (custom behavior)", () => {
  it("publishes exactly the small/normal/large enum", () => {
    expect(FONT_SIZE_PRESETS).toEqual(["small", "normal", "large"]);
  });

  it.each(FONT_SIZE_PRESETS)("applies %s as an explicit mark", (preset) => {
    const instance = open(doc(p(txt("texto"))));
    instance.commands.selectAll();
    expect(instance.commands.setFontSizePreset(preset)).toBe(true);
    expect(marksOf(instance)).toEqual([size(preset)]);
  });

  it("rejects an out-of-enum command value", () => {
    const instance = open(doc(p(txt("texto"))));
    instance.commands.selectAll();
    expect(instance.commands.setFontSizePreset("gigante" as FontSizePreset)).toBe(false);
    expect(instance.getJSON()).toEqual(doc(p(txt("texto"))));
  });

  it("keeps mixed sizes across selection changes", () => {
    const instance = open(doc(p(txt("uno dos"))));
    instance.commands.setTextSelection({ from: 1, to: 4 });
    instance.commands.setFontSizePreset("small");
    instance.commands.setTextSelection({ from: 4, to: 8 });
    instance.commands.setFontSizePreset("large");
    expect(instance.getJSON().content?.[0]?.content).toEqual([
      txt("uno", [size("small")]),
      txt(" dos", [size("large")]),
    ]);
  });

  it("inherits an active preset while typing", () => {
    const instance = open(doc(p(txt("holamundo"))));
    instance.commands.selectAll();
    instance.commands.setFontSizePreset("small");
    instance.commands.setTextSelection(5);
    instance.commands.insertContent(" ");
    // Adjacent identically-marked runs merge into one text node.
    expect(instance.getJSON().content?.[0]?.content).toEqual([txt("hola mundo", [size("small")])]);
  });

  it("undoes, redoes and unsets the size command", () => {
    const instance = open(doc(p(txt("texto"))));
    instance.commands.selectAll();
    instance.commands.setFontSizePreset("large");
    expect(instance.commands.undo()).toBe(true);
    expect(marksOf(instance)).toBeUndefined();
    expect(instance.commands.redo()).toBe(true);
    expect(marksOf(instance)).toEqual([size("large")]);
    expect(instance.commands.unsetFontSizePreset()).toBe(true);
    expect(marksOf(instance)).toBeUndefined();
  });

  it("rejects an invalid data-font-size-preset during HTML parsing", () => {
    const instance = open();
    instance.commands.setContent(
      '<p><span data-font-size-preset="small">bueno</span></p>' +
        '<p><span data-font-size-preset="gigante">malo</span></p>',
    );
    const [valid, invalid] = instance.getJSON().content ?? [];
    expect(valid?.content?.[0]).toEqual(txt("bueno", [size("small")]));
    expect(invalid?.content?.[0]).toEqual(txt("malo"));
  });
});

describe("external HTTP(S) link policy (custom behavior)", () => {
  const accepted: [string, string][] = [
    ["plain https", "https://example.com/vacante"],
    ["http with punctuation", "http://example.com:8443/a,b;c(d)e_f~g!h*i'j?q=1#frag"],
    ["uppercase scheme and query", "HTTPS://EXAMPLE.COM/path?q=a%20b"],
    ["unicode path", "https://sub.dominio.mx/página/日本語"],
    ["unicode host", "http://例え.jp/パス"],
  ];
  const rejected: [string, string][] = [
    ["leading/trailing whitespace", "  https://example.com/x  "],
    ["userinfo name", "https://user@example.com"],
    ["userinfo credentials", "https://user:pass@example.com"],
    ["raw tab", "https://exa\tmple.com"],
    ["raw newline", "https://exa\nmple.com"],
    ["raw backslash", "https://back\\slash.com"],
    ["nonexplicit scheme and host", "https:example.com"],
    ["nonexplicit single slash", "https:/example.com"],
    ["javascript", "javascript:alert(1)"],
    ["obfuscated javascript", "java\tscript:alert(1)"],
    ["data uri", "data:text/html,<script>alert(1)</script>"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["file", "file:///etc/passwd"],
    ["mailto", "mailto:rrhh@example.com"],
    ["tel", "tel:+525512345678"],
    ["ftp", "ftp://example.com/f"],
    ["protocol relative", "//example.com/schemeless"],
    ["absolute path", "/ruta/relativa"],
    ["relative path", "ruta/relativa"],
    ["schemeless host", "example.com"],
    ["scheme only", "https://"],
    ["space in host", "https://exa mple.com"],
    ["empty", ""],
    ["blank", "   "],
  ];

  it.each(accepted)("accepts %s", (_label, href) => {
    expect(isSafeExternalHref(href)).toBe(true);
  });
  it.each(rejected)("rejects %s", (_label, href) => {
    expect(isSafeExternalHref(href)).toBe(false);
  });
  it("rejects absent values", () => {
    expect(isSafeExternalHref(undefined)).toBe(false);
    expect(isSafeExternalHref(null)).toBe(false);
  });

  it("refuses unsafe setLink and keeps the JSON untouched", () => {
    const instance = open(doc(p(txt("texto"))));
    instance.commands.selectAll();
    expect(instance.commands.setLink({ href: "javascript:alert(1)" })).toBe(false);
    expect(instance.commands.setLink({ href: "mailto:a@b.com" })).toBe(false);
    expect(instance.getJSON()).toEqual(doc(p(txt("texto"))));
  });

  it("accepts an approved setLink destination with punctuation", () => {
    const instance = open(doc(p(txt("texto"))));
    instance.commands.selectAll();
    expect(
      instance.commands.setLink({
        href: "https://example.com/a,b;c(d)",
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        class: "enlace-externo",
        title: "Ejemplo",
      }),
    ).toBe(true);
    expect(marksOf(instance)).toEqual([
      {
        type: "link",
        attrs: {
          href: "https://example.com/a,b;c(d)",
          target: "_blank",
          rel: "noopener noreferrer nofollow",
          class: "enlace-externo",
          title: "Ejemplo",
        },
      },
    ]);
  });
});

describe("plain text extraction proposal", () => {
  const cases: [string, JSONContent, string][] = [
    ["empty document", doc(), ""],
    ["joined blocks", doc(p(txt("uno")), p(txt("dos"))), "uno\ndos"],
    ["blank paragraph", doc(p(), p()), "\n"],
    ["hard break", doc(p(txt("a"), block("hardBreak"), txt("b"))), "a\nb"],
    [
      "nested list without markers or trimming",
      doc(
        block("orderedList", { start: 3 }, [
          li(
            p(txt("  primero  ")),
            block("bulletList", undefined, [li(p(txt("anidado")))]),
          ),
          li(p(txt("segundo"))),
        ]),
      ),
      "  primero  \nanidado\nsegundo",
    ],
  ];
  it.each(cases)("extracts %s", (_label, json, expected) => {
    expect(toPlainText(json)).toBe(expected);
  });
});

describe("native tiptap 3.31.4 serialization (discovery, no prior RED)", () => {
  it("serializes an empty editor as a paragraph document", () => {
    expect(open().getJSON()).toEqual(doc(p()));
  });

  it("preserves ordered list start and the null marker type attribute", () => {
    const instance = open(
      doc(block("orderedList", { start: 3 }, [li(p(txt("tres"))), li(p(txt("cuatro")))])),
    );
    expect(instance.getJSON().content?.[0]).toEqual(
      block("orderedList", { start: 3, type: null }, [li(p(txt("tres"))), li(p(txt("cuatro")))]),
    );
  });

  it("records link defaults and the mark rank order", () => {
    const instance = open(doc(p(txt("texto"))));
    instance.commands.selectAll();
    instance.commands.setBold();
    instance.commands.setItalic();
    instance.commands.setLink({ href: "https://example.com" });
    instance.commands.setFontSizePreset("small");
    expect(marksOf(instance)).toEqual([
      { type: "link", attrs: { href: "https://example.com", ...LINK_DEFAULTS } },
      { type: "bold" },
      { type: "italic" },
      size("small"),
    ]);
  });

  it("preserves hardBreak marks and untrusted JSON hrefs", () => {
    const instance = open(
      doc(p(txt("linea", [{ type: "bold" }]), block("hardBreak", undefined, undefined, [{ type: "italic" }]), txt("dos"))),
    );
    expect(instance.getJSON().content?.[0]?.content).toEqual([
      txt("linea", [{ type: "bold" }]),
      block("hardBreak", undefined, undefined, [{ type: "italic" }]),
      txt("dos"),
    ]);

    const untrusted = open(
      doc(p(txt("peligro", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))),
    );
    // JSON is not sanitized by the editor; Go must validate stored documents.
    expect(marksOf(untrusted)).toEqual([
      { type: "link", attrs: { href: "javascript:alert(1)", ...LINK_DEFAULTS } },
    ]);
  });
});

type Case = { id: string; note: string; json: JSONContent; plainText: string };

function buildCase(id: string, note: string, content: JSONContent): Case {
  const json = open(content).getJSON();
  return { id, note, json, plainText: toPlainText(json) };
}

function corpus(): Case[] {
  const cases: Case[] = [
    buildCase("empty-document", "new editor with no content", doc(p())),
    buildCase("empty-paragraphs", "text, empty paragraph, text", doc(p(txt("uno")), p(), p(txt("dos")))),
    buildCase(
      "unicode-combined-marks",
      "bold+italic+small over unicode",
      doc(p(txt("Café ☕ 日本語 👩🏽‍💻", [{ type: "bold" }, { type: "italic" }, size("small")])), p(txt("fin"))),
    ),
    buildCase(
      "ordered-list-start-3",
      "ordered list with start != 1",
      doc(block("orderedList", { start: 3 }, [li(p(txt("tres"))), li(p(txt("cuatro")))])),
    ),
    buildCase(
      "nested-lists-mixed-marks",
      "bullet list with nested ordered list and mixed marks",
      doc(
        block("bulletList", undefined, [
          li(
            p(txt("padre", [{ type: "bold" }])),
            block("orderedList", { start: 1 }, [li(p(txt("hijo", [size("large")])))]),
          ),
        ]),
      ),
    ),
    buildCase(
      "hard-breaks",
      "hard break between marked and unmarked runs",
      doc(p(txt("linea uno", [{ type: "italic" }]), block("hardBreak"), txt("linea dos"))),
    ),
    buildCase(
      "mixed-marks-and-link",
      "bold, italic, size and link marks on one paragraph",
      doc(
        p(
          txt("negrita ", [{ type: "bold" }]),
          txt("cursiva ", [{ type: "italic" }]),
          txt("grande", [size("large")]),
          txt(" y "),
          txt("enlace", [
            {
              type: "link",
              attrs: {
                href: "https://example.com/a,b;c(d)",
                target: "_blank",
                rel: "noopener noreferrer nofollow",
                class: "enlace-externo",
                title: "Ejemplo",
              },
            },
          ]),
        ),
      ),
    ),
  ];

  const commandBuilt = open(doc(p(txt("uno dos"))));
  commandBuilt.commands.setTextSelection({ from: 1, to: 4 });
  commandBuilt.commands.setFontSizePreset("small");
  commandBuilt.commands.setTextSelection({ from: 4, to: 8 });
  commandBuilt.commands.setFontSizePreset("normal");
  const json = commandBuilt.getJSON();
  cases.push({ id: "command-size-presets", note: "small + normal applied via commands", json, plainText: toPlainText(json) });
  return cases;
}

describe("runtime fixture corpus", () => {
  it("matches the committed fixtures and restores into a fresh editor", () => {
    const stored = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
      schemaVersion: string;
      tiptap: Record<string, string>;
      cases: Case[];
    };
    expect(stored.schemaVersion).toBe(SCHEMA_VERSION);
    expect(stored.tiptap).toEqual(TIPTAP_PACKAGE_VERSIONS);
    expect(corpus()).toEqual(stored.cases);
    for (const item of stored.cases) {
      expect(open(item.json).getJSON(), item.id).toEqual(item.json);
    }
  });
});

if (process.env.TIPTAP_EMIT_FIXTURES === "1") {
  it("emits the runtime fixture corpus", () => {
    mkdirSync(join(PROOF_DIR, "fixtures"), { recursive: true });
    writeFileSync(
      FIXTURE_PATH,
      `${JSON.stringify(
        {
          schemaVersion: SCHEMA_VERSION,
          tiptap: TIPTAP_PACKAGE_VERSIONS,
          generatedBy: "vitest/schema.test.ts",
          cases: corpus(),
        },
        null,
        2,
      )}\n`,
    );
    expect(true).toBe(true);
  });
}
