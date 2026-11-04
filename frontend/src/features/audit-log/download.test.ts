import { expect, it } from "vitest";
import { downloadFilename } from "./download";

it("takes the filename from Content-Disposition", () => {
  expect(downloadFilename('attachment; filename="auditoria-2026-11-04.csv"')).toBe("auditoria-2026-11-04.csv");
  expect(downloadFilename("attachment; filename=auditoria.csv")).toBe("auditoria.csv");
});
it("falls back to a safe name when the header is missing or hostile", () => {
  for (const header of [null, "attachment", 'attachment; filename="../../etc/passwd"', 'attachment; filename="a b<script>.csv"', 'attachment; filename=""']) {
    expect(downloadFilename(header)).toBe("auditoria.csv");
  }
});
