import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fromDelivery } from "@/features/jobs/drafts/pipeline/delivery-model";
import { BusinessDateField, DeliveryDateField } from "./date-field";

const calendar = { timeZone: "America/Mexico_City", today: "2026-11-02", minDate: "2026-11-02", maxDate: "2027-11-02", nonBusinessDates: ["2026-11-16"] };

describe("DeliveryDateField", () => {
  it("keeps the delivery commitment label, ids and description", () => {
    const state = fromDelivery({ cutoffStageId: null, targetQuantity: null, commitmentDate: "2026-11-30", limits: { minTarget: 1, maxTarget: 999 }, calendar, version: "1" } as never);
    render(<DeliveryDateField state={state} disabled={false} onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Fecha compromiso" });
    expect(trigger.getAttribute("id")).toBe("delivery-date");
    expect(trigger.getAttribute("aria-describedby")).toBe("delivery-date-description");
    expect(document.getElementById("delivery-date-label")?.textContent).toContain("Fecha compromiso");
    expect(document.getElementById("delivery-date-description")?.textContent).toContain("Días hábiles en México entre hoy y dentro de un año. Fines de semana y días de descanso obligatorio no se pueden elegir.");
    expect(screen.getByRole("button", { name: "Quitar fecha" })).toBeTruthy();
  });
});

describe("BusinessDateField", () => {
  it("builds every id from its own id and uses its own label, description and clear label", () => {
    render(<BusinessDateField id="recruiter-deadline" label="Plazo del reclutador" description="Si no lo defines, aplica la fecha compromiso." clearLabel="Usar la fecha compromiso"
      value="2026-11-20" calendar={calendar} disabled={false} onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Plazo del reclutador" });
    expect(trigger.getAttribute("id")).toBe("recruiter-deadline");
    expect(trigger.getAttribute("aria-describedby")).toBe("recruiter-deadline-description");
    expect(document.getElementById("recruiter-deadline-description")?.textContent).toContain("Si no lo defines, aplica la fecha compromiso.");
    expect(screen.getByRole("button", { name: "Usar la fecha compromiso" })).toBeTruthy();
    expect(document.getElementById("delivery-date")).toBeNull();
  });

  it("shows the error message wired to the trigger", () => {
    render(<BusinessDateField id="recruiter-deadline" label="Plazo del reclutador" description="Ayuda" value={null} calendar={calendar} disabled={false}
      errorMessage="Ese día no es hábil. Elige otro." onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Plazo del reclutador" }).getAttribute("aria-describedby")).toBe("recruiter-deadline-description recruiter-deadline-error");
    expect(document.getElementById("recruiter-deadline-error")?.textContent).toContain("Ese día no es hábil. Elige otro.");
    expect(screen.queryByRole("button", { name: /Quitar|Usar/ })).toBeNull();
  });
});
