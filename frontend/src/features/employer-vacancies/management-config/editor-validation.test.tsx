import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { saveDraftManagementAction } from "@/features/jobs/drafts/pipeline/management-actions";
import { ManagementEditor } from "./editor";
import { managementFixture } from "./test-fixture";
vi.mock("@/features/jobs/drafts/pipeline/management-actions", () => ({ loadDraftManagementAction: vi.fn(), saveDraftManagementAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("./date-field", async importOriginal => {
  const { ManagementDateField } = await importOriginal<typeof import("./date-field")>();
  return { ManagementDateField: (props: React.ComponentProps<typeof ManagementDateField>) => <>
    <ManagementDateField {...props} />
    {/* Exercise the parent's validation boundary even if the picker emits a bad date. */}
    <button onClick={() => props.onChange("2026-10-17")}>Emitir fecha futura</button>
  </> };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("rejects a changed future date and focuses it before another invalid field", () => {
  render(<ManagementEditor draftId="123e4567-e89b-42d3-a456-426614174000" management={managementFixture()} etag='"management"' />);
  fireEvent.change(screen.getByRole("textbox", { name: "Plazas a cubrir" }), { target: { value: "abc" } });
  fireEvent.click(screen.getByRole("button", { name: "Emitir fecha futura" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(saveDraftManagementAction).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Fecha de solicitud" })).toHaveFocus();
  expect(screen.getByText("Elige hoy o una fecha pasada.")).toHaveAttribute("data-slot", "field-error");
  expect(screen.getByText("Escribe un número entero.")).toHaveAttribute("data-slot", "field-error");
});
