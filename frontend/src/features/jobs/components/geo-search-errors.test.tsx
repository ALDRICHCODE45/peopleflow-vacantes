import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { JobsResults } from "./JobsResults";
afterEach(cleanup);
it("does not offer a same-filter restart for an invalid request without a cursor", () => {
  render(<JobsResults query={{ q: "bad" }} result={{ ok: false, error: { kind: "status", status: 400, retryable: false }, envelope: { code: "invalid_request" } }} />);
  expect(screen.getByRole("link", { name: "Quitar filtros" }).getAttribute("href")).toBe("/vacantes");
});
it.each(["invalid_filter", "invalid_request"] as const)("offers explicit recovery for %s", code => {
  render(<JobsResults query={{ state: ["09"], cursor: "old" }} result={{ ok: false, error: { kind: "status", status: 400, retryable: false }, envelope: { code } }} />);
  const link = screen.getByRole("link", { name: code === "invalid_filter" ? "Quitar filtros" : "Volver al inicio de la búsqueda" });
  expect(link.getAttribute("href")).toBe(code === "invalid_filter" ? "/vacantes" : "/vacantes?state=09");
  expect(screen.queryByText("Intentar de nuevo")).toBeNull();
});
