import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getSchema } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  TIPTAP_PACKAGE_VERSIONS,
  buildProofExtensions,
  createProofEditor,
  toPlainText,
} from "../tiptap-contract-proof/schema";

const SUPPLEMENT_PATH = join(
  process.cwd(),
  "src",
  "features",
  "jobs",
  "draft-contract-fixtures",
  "editor-supplement.fixtures.json",
);
const ORIGINAL_PROOF_PATH = join(
  process.cwd(),
  "src",
  "features",
  "jobs",
  "tiptap-contract-proof",
  "fixtures",
  "tiptap-draft-contract.fixtures.json",
);
const ORIGINAL_PROOF_SHA256 = "8477901e59fd99657ef9f320547560bce940aebbcd3c2c96c514eff4363fd4e5";

type ApiExpectation = { status: number; code: string; reason: string };
type RoundtripCase = {
  id: string;
  note: string;
  input: JSONContent;
  expected: JSONContent;
  plainText: string;
};
type RawLinkContract = { document: JSONContent; valid: boolean; errorCode: "validation_error" | null };
type HtmlCase = {
  id: string;
  note: string;
  html: string;
  expected: JSONContent;
  plainText: string;
  rawLinkContract: RawLinkContract;
  editorOutputContract: { subject: "expected"; valid: true };
};
type NegativeCase = {
  id: string;
  note: string;
  input: JSONContent;
  strictProseMirror: { construction: string; errorName: string; message: string };
  editorObservation: { construction: string; output: JSONContent };
  plainText: string;
  apiExpectation: ApiExpectation;
};
type Supplement = {
  supplementVersion: string;
  designScope: string;
  dataContract: { transferableToGo: boolean; shape: Record<string, string> };
  provenance: {
    editorOnly: boolean;
    scope: string;
    notClaimed: string[];
    generatedBy: string;
    tiptap: Record<string, string>;
    apiVersion: { descriptionSchemaVersion: number; note: string };
    goConsumption: string;
  };
  originalProof: { path: string; sha256: string; cases: number; relationship: string };
  cases: { hardBreakRoundtrips: RoundtripCase[]; htmlIngestion: HtmlCase[]; negatives: NegativeCase[] };
};

const supplement = JSON.parse(readFileSync(SUPPLEMENT_PATH, "utf8")) as Supplement;

const live: Editor[] = [];
const open = (content?: JSONContent): Editor => {
  const instance = createProofEditor(content);
  live.push(instance);
  return instance;
};
afterEach(() => {
  while (live.length > 0) live.pop()?.destroy();
});

function linkHref(node: JSONContent): string | null {
  let href: string | null = null;
  const walk = (current: JSONContent): void => {
    for (const mark of current.marks ?? []) {
      if (mark.type === "link" && typeof mark.attrs?.href === "string") href = mark.attrs.href;
    }
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return href;
}

describe("supplement metadata and original proof lock", () => {
  it("locks the approved corpus byte-for-byte at its declared SHA-256", () => {
    const bytes = readFileSync(ORIGINAL_PROOF_PATH);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ORIGINAL_PROOF_SHA256);
    expect(supplement.originalProof.sha256).toBe(ORIGINAL_PROOF_SHA256);
    expect(supplement.originalProof.cases).toBe(8);
    expect(supplement.originalProof.relationship).toMatch(/additive|separate/i);
  });

  it("locks stable case IDs and keeps every array non-vacuous", () => {
    const allIds = [
      ...supplement.cases.hardBreakRoundtrips,
      ...supplement.cases.htmlIngestion,
      ...supplement.cases.negatives,
    ].map((item) => item.id);
    expect(new Set(allIds).size, "case IDs must be unique").toBe(allIds.length);
    expect(supplement.cases.hardBreakRoundtrips.map((item) => item.id)).toEqual([
      "hardbreak-marked-roundtrip",
      "hardbreak-plain-between-marked-runs",
    ]);
    expect(supplement.cases.htmlIngestion.map((item) => item.id)).toEqual([
      "html-safe-link-control",
      "html-unsafe-link-javascript",
      "html-unsafe-link-data-uri",
      "html-unsafe-link-credentials",
    ]);
    expect(supplement.cases.negatives.map((item) => item.id)).toEqual(["empty-text-node-strict-construction"]);
  });

  it("declares editor-only provenance with a separate numeric API version", () => {
    expect(supplement.dataContract.transferableToGo).toBe(true);
    expect(supplement.designScope).toMatch(/description\.document/);
    expect(supplement.designScope).toMatch(/no HTTP status/i);
    expect(supplement.provenance.editorOnly).toBe(true);
    expect(supplement.provenance.tiptap).toEqual(TIPTAP_PACKAGE_VERSIONS);
    expect(supplement.provenance.notClaimed).toContain("Go validation");
    expect(supplement.provenance.notClaimed).toContain("cross-language serializer parity");
    expect(supplement.provenance.notClaimed).toContain("HTTP status or success codes");
    expect(supplement.provenance.apiVersion.descriptionSchemaVersion).toBe(1);
    expect(supplement.provenance.goConsumption).toMatch(/pending/i);
    expect(supplement.provenance.generatedBy).toMatch(/never enabled/i);
    const shapeKeys = Object.keys(supplement.dataContract.shape);
    expect(shapeKeys.some((key) => key.startsWith("cases.htmlIngestion[].apiExpectation"))).toBe(false);
    expect(shapeKeys).toContain("cases.htmlIngestion[].rawLinkContract.document");
    expect(shapeKeys).toContain("cases.htmlIngestion[].editorOutputContract");
  });
});

describe("marked-hardBreak serialization roundtrip", () => {
  it.each(supplement.cases.hardBreakRoundtrips)("$id serializes and restores to the authored shape", (item) => {
    const first = open(item.input).getJSON();
    expect(first, `${item.id}: first serialization`).toEqual(item.expected);
    const restored = open(first).getJSON();
    expect(restored, `${item.id}: restored serialization`).toEqual(item.expected);
    expect(toPlainText(restored), `${item.id}: plain text`).toBe(item.plainText);
  });
});

describe("unsafe-link HTML ingestion negatives", () => {
  it.each(supplement.cases.htmlIngestion)("$id ingests to the authored sanitized observation", (item) => {
    const instance = open();
    instance.commands.setContent(item.html);
    const json = instance.getJSON();
    expect(json, `${item.id}: serialized`).toEqual(item.expected);
    expect(toPlainText(json), `${item.id}: plain text`).toBe(item.plainText);
  });

  it("separates the raw description.document expectation from the sanitized editor output", () => {
    for (const item of supplement.cases.htmlIngestion) {
      const htmlHref = /href="([^"]*)"/.exec(item.html)?.[1] ?? null;
      const rawJson = JSON.stringify(item.rawLinkContract.document);
      const sanitizedJson = JSON.stringify(item.expected);

      expect(linkHref(item.rawLinkContract.document), `${item.id}: raw doc preserves the HTML href`).toBe(htmlHref);
      expect(rawJson, `${item.id}: raw doc keeps a link mark`).toContain('"type":"link"');
      expect(item.editorOutputContract).toEqual({ subject: "expected", valid: true });

      if (item.rawLinkContract.valid) {
        expect(item.rawLinkContract.errorCode, `${item.id}: valid raw link has no error`).toBeNull();
        expect(sanitizedJson, `${item.id}: sanitized keeps the safe link`).toContain('"type":"link"');
      } else {
        expect(item.rawLinkContract.errorCode, `${item.id}: invalid raw link code`).toBe("validation_error");
        expect(sanitizedJson, `${item.id}: sanitized drops the unsafe link`).not.toContain('"type":"link"');
      }
    }
  });

  it("claims no HTTP status or success code for editor output", () => {
    for (const item of supplement.cases.htmlIngestion) {
      expect(item, `${item.id}: no obsolete apiExpectation`).not.toHaveProperty("apiExpectation");
      expect(JSON.stringify(item), `${item.id}: no status claim`).not.toContain('"status"');
    }
  });
});

describe("empty text negative at strict ProseMirror construction", () => {
  const schema = getSchema(buildProofExtensions());

  it.each(supplement.cases.negatives)("$id is rejected by schema.nodeFromJSON", (item) => {
    expect(() => schema.nodeFromJSON(item.input)).toThrow(item.strictProseMirror.errorName === "RangeError" ? RangeError : Error);
    expect(() => schema.nodeFromJSON(item.input)).toThrow(item.strictProseMirror.message);
    expect(() => schema.nodeFromJSON({ type: "text", text: "" })).toThrow(item.strictProseMirror.message);

    // Honest observation: the real editor silently recovers instead of throwing.
    const instance = open(item.input);
    expect(instance.getJSON(), `${item.id}: editor recovery observation`).toEqual(item.editorObservation.output);
    expect(toPlainText(instance.getJSON())).toBe(item.plainText);
    expect(item.apiExpectation.status).toBe(400);
    expect(item.apiExpectation.code).toBe("validation_error");
  });
});
