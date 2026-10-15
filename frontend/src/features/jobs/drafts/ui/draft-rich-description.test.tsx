import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import type { DraftRichEnvelope } from "../rich/grammar";
import {
  DraftRichDescriptionContent,
  resolveDraftRichDescription,
} from "./draft-rich-description";

/**
 * The renderer owns the full-schema validation of the raw description before it
 * emits any React node: no dangerous HTML, no attribute spread and no mutation
 * of the stored draft. These tests cover every supported node and mark, nested
 * combinations, list starts, empty paragraphs, safe links and the honest
 * rejection of invalid or oversized input.
 */

const text = (value: string, marks?: unknown): Record<string, unknown> =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks };
const paragraph = (content?: unknown): Record<string, unknown> =>
  content === undefined ? { type: "paragraph" } : { type: "paragraph", content };
const doc = (content: unknown): Record<string, unknown> => ({ type: "doc", content });
const envelope = (document: unknown): Record<string, unknown> => ({
  schema_version: 1,
  document,
});

const linkAttrs = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  href: "https://example.com/articulo",
  target: null,
  rel: null,
  class: null,
  title: null,
  ...overrides,
});

/** Resolve raw input, failing the test when it is not renderable. */
function ready(input: unknown): DraftRichEnvelope {
  const resolution = resolveDraftRichDescription(input);
  if (resolution.kind !== "ready") {
    throw new Error(`expected a ready description, got ${resolution.kind}`);
  }
  return resolution.description;
}

afterEach(() => {
  cleanup();
});

describe("literal rich-text whitespace", () => {
  it("preserves literal newlines in ordinary and marked list paragraphs", () => {
    const input = envelope(doc([
      paragraph([text("Primera\nSegunda")]),
      { type: "bulletList", content: [
        { type: "listItem", content: [paragraph([text("Uno\nDos", [{ type: "bold" }])])] },
      ] },
    ]));
    const before = structuredClone(input);
    const { container } = render(<DraftRichDescriptionContent description={ready(input)} />);
    const paragraphs = container.querySelectorAll("p");

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe("Primera\nSegunda");
    expect(paragraphs[1].querySelector("strong")?.textContent).toBe("Uno\nDos");
    for (const paragraph of paragraphs) expect(paragraph).toHaveClass("whitespace-pre-wrap");
    expect(input).toStrictEqual(before);
  });
});

describe("resolveDraftRichDescription", () => {
  it("treats null as the empty description", () => {
    expect(resolveDraftRichDescription(null)).toEqual({ kind: "empty" });
  });

  it("returns the validated envelope unchanged", () => {
    const input = envelope(doc([paragraph([text("Hola")])]));
    const before = structuredClone(input);

    const resolution = resolveDraftRichDescription(input);

    expect(resolution.kind).toBe("ready");
    expect(input).toStrictEqual(before);
  });

  const invalid: Array<[string, unknown]> = [
    [
      "a javascript link",
      envelope(
        doc([
          paragraph([
            text("x", [{ type: "link", attrs: linkAttrs({ href: "javascript:alert(1)" }) }]),
          ]),
        ]),
      ),
    ],
    [
      "malformed marks",
      envelope(doc([paragraph([text("x", [{ type: "bold", attrs: {} }])])])),
    ],
    [
      "unknown node attributes",
      envelope(doc([{ type: "paragraph", content: [text("x")], extra: true }])),
    ],
    [
      "an oversized plain text",
      envelope(doc([paragraph([text("a".repeat(70000))])])),
    ],
  ];

  it.each(invalid)("rejects %s", (_name, input) => {
    expect(resolveDraftRichDescription(input)).toEqual({ kind: "invalid" });
  });
});

describe("DraftRichDescriptionContent", () => {
  it("renders paragraphs, hard breaks and escaped text as React nodes", () => {
    const input = envelope(
      doc([
        paragraph([text("Primera línea"), { type: "hardBreak" }, text("Segunda línea")]),
        paragraph([text("<script>alert(1)</script>")]),
      ]),
    );

    const { container } = render(
      <DraftRichDescriptionContent description={ready(input)} />,
    );

    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders every supported mark and a nested combination deterministically", () => {
    const ordered = envelope(
      doc([
        paragraph([
          text("fuerte", [{ type: "bold" }]),
          text("cursiva", [{ type: "italic" }]),
          text("grande", [{ type: "fontSizePreset", attrs: { preset: "large" } }]),
        ]),
        paragraph([
          text("combo", [
            { type: "fontSizePreset", attrs: { preset: "small" } },
            { type: "link", attrs: linkAttrs() },
            { type: "italic" },
            { type: "bold" },
          ]),
        ]),
      ]),
    );
    const reordered = envelope(
      doc([
        paragraph([
          text("combo", [
            { type: "bold" },
            { type: "italic" },
            { type: "link", attrs: linkAttrs() },
            { type: "fontSizePreset", attrs: { preset: "small" } },
          ]),
        ]),
      ]),
    );

    const first = render(<DraftRichDescriptionContent description={ready(ordered)} />);
    expect(first.container.querySelector("strong")?.textContent).toBe("fuerte");
    expect(first.container.querySelector("em")?.textContent).toBe("cursiva");
    expect(first.container.querySelector("span.text-lg")?.textContent).toBe("grande");
    expect(
      first.container.querySelector("a > span.text-sm > em > strong")?.textContent,
    ).toBe("combo");
    first.unmount();

    const second = render(
      <DraftRichDescriptionContent description={ready(reordered)} />,
    );
    expect(second.container.querySelector("a > span.text-sm > em > strong")).not.toBeNull();
  });

  it("renders bullet and ordered lists with the exact ordered start", () => {
    const input = envelope(
      doc([
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [paragraph([text("uno")])],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 3, type: null },
          content: [
            { type: "listItem", content: [paragraph([text("tres")])] },
            { type: "listItem", content: [paragraph([text("cuatro")])] },
          ],
        },
      ]),
    );

    const { container } = render(
      <DraftRichDescriptionContent description={ready(input)} />,
    );

    expect(container.querySelector("ul")?.className).toContain("list-disc");
    const ordered = container.querySelector("ol");
    expect(ordered?.className).toContain("list-decimal");
    expect(ordered?.getAttribute("start")).toBe("3");
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("keeps an empty paragraph visible with a break", () => {
    const input = envelope(doc([paragraph(), paragraph([])]));

    const { container } = render(
      <DraftRichDescriptionContent description={ready(input)} />,
    );

    const paragraphs = Array.from(container.querySelectorAll("p"));
    expect(paragraphs).toHaveLength(2);
    for (const node of paragraphs) {
      expect(node.querySelector("br")).not.toBeNull();
    }
  });

  it("renders validated link attributes and hardens _blank without overwriting rel", () => {
    const input = envelope(
      doc([
        paragraph([
          text("externo", [
            {
              type: "link",
              attrs: linkAttrs({
                target: "_blank",
                rel: "noreferrer nofollow",
                class: "enlace-externo",
                title: "Ejemplo",
              }),
            },
          ]),
        ]),
        paragraph([
          text("sin rel", [{ type: "link", attrs: linkAttrs({ target: "_blank" }) }]),
        ]),
        paragraph([text("mismo", [{ type: "link", attrs: linkAttrs({ target: "_self" }) }])]),
      ]),
    );

    const { container } = render(
      <DraftRichDescriptionContent description={ready(input)} />,
    );
    const anchors = Array.from(container.querySelectorAll("a"));

    expect(anchors).toHaveLength(3);
    expect(anchors[0].getAttribute("href")).toBe("https://example.com/articulo");
    expect(anchors[0].getAttribute("target")).toBe("_blank");
    expect(anchors[0].getAttribute("rel")).toBe("noreferrer nofollow noopener");
    expect(anchors[0].getAttribute("title")).toBe("Ejemplo");
    expect(anchors[0].className).toContain("enlace-externo");
    expect(anchors[1].getAttribute("rel")).toBe("noopener");
    expect(anchors[2].getAttribute("target")).toBe("_self");
    expect(anchors[2].getAttribute("rel")).toBeNull();
  });

  it("never mutates the raw source while resolving or rendering", () => {
    const input = envelope(
      doc([
        paragraph([
          text("x", [{ type: "link", attrs: linkAttrs({ target: "_blank" }) }]),
        ]),
      ]),
    );
    const before = structuredClone(input);

    render(<DraftRichDescriptionContent description={ready(input)} />);

    expect(input).toStrictEqual(before);
  });
});
