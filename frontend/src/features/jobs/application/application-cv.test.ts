import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  APPLICATION_CV_EXTENSIONS,
  APPLICATION_CV_FORMATS_LABEL,
  APPLICATION_CV_INPUT_ID,
  APPLICATION_CV_MAX_BYTES,
  applicationCvExtension,
  applicationCvFormatLabel,
  formatApplicationCvSize,
  isApplicationCvExtension,
  parseApplicationCvSelection,
} from "./application-cv";
import type {
  ApplicationCvFileLike,
  ApplicationCvSelectionResult,
} from "./application-cv";

/**
 * The pure local-CV contract. It only knows a file's declared name, byte size
 * and MIME hint, so every case below is a plain object; the extension and size
 * checks are convenience rules, never a content-security claim.
 */
const SOURCE = readFileSync(
  join(process.cwd(), "src", "features", "jobs", "application", "application-cv.ts"),
  "utf8",
);
const specifiers = (): readonly string[] => [
  ...new Set([...SOURCE.matchAll(/from\s*"([^"]+)"/gu)].map((match) => match[1])),
];

const file = (patch: Partial<ApplicationCvFileLike> = {}): ApplicationCvFileLike => ({
  name: "cv.pdf",
  size: 1024,
  type: "application/pdf",
  ...patch,
});

/** Parses a selection that must pass and returns its accepted file. */
function accepted(files: readonly ApplicationCvFileLike[] | null): ApplicationCvFileLike {
  const result = parseApplicationCvSelection(files);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.file;
}

/** Parses a selection that must fail and returns its single issue. */
function issueOf(files: readonly ApplicationCvFileLike[] | null | undefined): { readonly code: string; readonly message: string } {
  const result = parseApplicationCvSelection(files);
  if (result.ok) throw new Error("expected a validation issue");
  expect(result.issues).toHaveLength(1);
  return result.issues[0];
}

describe("application CV model", () => {
  it("declares the exact local vocabulary, inclusive limit and shared input id", () => {
    expect(APPLICATION_CV_EXTENSIONS).toEqual(["pdf", "doc", "docx"]);
    expect(APPLICATION_CV_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(APPLICATION_CV_FORMATS_LABEL).toBe("PDF, DOC o DOCX");
    expect(APPLICATION_CV_INPUT_ID).toBe("application-cv-file");
    expect(isApplicationCvExtension("pdf")).toBe(true);
    expect(isApplicationCvExtension("PDF")).toBe(false);
  });

  it("reads the trailing extension lowercased and treats a missing one as absent", () => {
    expect(applicationCvExtension("CV.PDF")).toBe("pdf");
    expect(applicationCvExtension("Mi Cv.DocX")).toBe("docx");
    expect(applicationCvExtension("curriculum.doc")).toBe("doc");
    expect(applicationCvExtension("cv")).toBe("");
    expect(applicationCvExtension("cv.")).toBe("");
    expect(applicationCvExtension("respaldo.tar.gz")).toBe("gz");
  });

  it("accepts allowed extensions case-insensitively regardless of the MIME hint", () => {
    for (const name of ["cv.pdf", "CV.PDF", "cv.Doc", "cv.dOcX"]) {
      expect(accepted([file({ name })])).toEqual(file({ name }));
    }
    // The MIME type is a hint only: blank and variant values are allowed.
    for (const type of ["application/pdf", "application/msword", "application/octet-stream", "", "text/plain"]) {
      expect(accepted([file({ type })]).type).toBe(type);
    }
  });

  it("rejects a disallowed extension with the shared Spanish message", () => {
    const issue = issueOf([file({ name: "cv.txt" })]);
    expect(issue.code).toBe("extension");
    expect(issue.message).toBe("El CV debe estar en formato PDF, DOC o DOCX.");
    expect(issueOf([file({ name: "cv.exe" })]).code).toBe("extension");
    expect(issueOf([file({ name: "cv" })]).code).toBe("extension");
  });

  it("accepts exactly 10 MiB and rejects one byte more", () => {
    expect(parseApplicationCvSelection([file({ size: APPLICATION_CV_MAX_BYTES })]).ok).toBe(true);
    const issue = issueOf([file({ size: APPLICATION_CV_MAX_BYTES + 1 })]);
    expect(issue.code).toBe("size");
    expect(issue.message).toBe("El CV no puede superar los 10 MB.");
    expect(parseApplicationCvSelection([file({ size: 0 })]).ok).toBe(true);
  });

  it("requires exactly one file", () => {
    for (const input of [null, undefined, [], [file(), file({ name: "carta.pdf" })]]) {
      const issue = issueOf(input);
      expect(issue.code).toBe("count");
      expect(issue.message).toBe("Selecciona un solo archivo para tu CV.");
    }
  });

  it("returns the accepted file unchanged and stays exhaustively typed", () => {
    const original = file({ name: "Mi Cv.PDF", size: 51_200, type: "" });
    expect(accepted([original])).toBe(original);
    expectTypeOf(parseApplicationCvSelection([original])).toEqualTypeOf<
      ApplicationCvSelectionResult<ApplicationCvFileLike>
    >();
  });

  it("formats deterministic KB and MB sizes and the uppercased format label", () => {
    expect(formatApplicationCvSize(0)).toBe("0 KB");
    expect(formatApplicationCvSize(1024)).toBe("1 KB");
    expect(formatApplicationCvSize(340 * 1024)).toBe("340 KB");
    expect(formatApplicationCvSize(1536)).toBe("2 KB");
    expect(formatApplicationCvSize(1024 * 1024)).toBe("1 MB");
    expect(formatApplicationCvSize(2_621_440)).toBe("2.5 MB");
    expect(formatApplicationCvSize(APPLICATION_CV_MAX_BYTES)).toBe("10 MB");
    expect(applicationCvFormatLabel("mi cv.PDF")).toBe("PDF");
    expect(applicationCvFormatLabel("cv.docx")).toBe("DOCX");
  });

  it("stays pure: no React, transport, storage, browser, timer or randomness", () => {
    expect(specifiers()).toEqual([]);
    expect(SOURCE).not.toMatch(/"use client"|\buseState\b|\buseRef\b|\buseEffect\b/u);
    for (const pattern of [
      /\bfetch\(|XMLHttpRequest|axios/u,
      /localStorage|sessionStorage|indexedDB|URL\.createObjectURL|FileReader|FormData/u,
      /document\.|window\.|navigator\.|next\/navigation|useRouter/u,
      /setTimeout|setInterval|Math\.random|Date\.now|new Date\(|randomUUID/u,
    ]) {
      expect(SOURCE).not.toMatch(pattern);
    }
  });
});
