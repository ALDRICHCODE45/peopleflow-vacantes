import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BoardLifecycle } from "./board-lifecycle";
import { boardFixture } from "./board-fixture";
afterEach(cleanup);
it.each([["filled", "Cubierta"], ["cancelled", "Cancelada"], ["other", "Otro"], [null, "Sin motivo registrado"]] as const)("shows closed header reason %s even without a date", (reason, label) => {
 render(<BoardLifecycle lifecycle={{ ...boardFixture().lifecycle, publication: "closed", close_reason: reason, close_reason_note: reason === "other" ? "Cambio de planes" : null, closed_at: null }} />);
 expect(screen.getByText(label, { exact: false })).toBeVisible();
 if (reason === "other") expect(screen.getByText("Cambio de planes")).toBeVisible();
});
