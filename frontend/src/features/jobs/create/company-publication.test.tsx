import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  EmployerSessionProvider,
  useEmployerSession,
} from "@/features/company-site-editor/employer-session";
import { CreateVacancyForm } from "./CreateVacancyForm";
import { INITIAL_VALUES } from "./form/model";
import type { VacancyFormValues } from "./form/model";

/** A contract-valid draft: every required field the schema rejects is filled. */
const VALID_VALUES: VacancyFormValues = {
  ...INITIAL_VALUES,
  title: "Backend Developer (Senior)",
  description: "Diseñá los servicios core.",
  workMode: "remote",
  employmentType: "full_time",
  seniority: "senior",
};

/**
 * Writes the shared session through its real API: the vacancy draft the wizard
 * validates and the company draft the publication gate reads. Keeping it a
 * button surface lets the tests seed state the real form has to consume.
 */
function SessionSeed() {
  const session = useEmployerSession();

  return (
    <div>
      <button
        type="button"
        onClick={() => session.setVacancyValues(VALID_VALUES)}
      >
        Cargar vacante válida
      </button>
      <button
        type="button"
        onClick={() =>
          session.setVacancyValues((previous) => ({ ...previous, description: "" }))
        }
      >
        Vaciar descripción
      </button>
      <button
        type="button"
        onClick={() =>
          session.setPrototypeValues((previous) => ({
            ...previous,
            department: "Producto",
          }))
        }
      >
        Cargar departamento
      </button>
      <button type="button" onClick={() => session.setVacancyStep("review")}>
        Ir a revisar
      </button>
      <button
        type="button"
        onClick={() =>
          session.updateCompanyField("about", "Somos un equipo de producto.")
        }
      >
        Guardar historia
      </button>
      <button type="button" onClick={() => session.confirmCompanyName()}>
        Confirmar nombre
      </button>
    </div>
  );
}

/**
 * The real creation surface mounted under the same provider the employer layout
 * keeps alive, beside the seed surface that writes the shared session.
 */
function withFormElement() {
  return (
    <EmployerSessionProvider>
      <SessionSeed />
      <CreateVacancyForm />
    </EmployerSessionProvider>
  );
}

function mountEmployer() {
  return render(
    <EmployerSessionProvider>
      <SessionSeed />
    </EmployerSessionProvider>,
  );
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

const stepRegion = () =>
  document.querySelector("[data-pf-step-region]") as HTMLElement;

const reviewGroup = (id: string): HTMLElement => {
  const group = document.querySelector(`[data-pf-review-group='${id}']`);
  if (group === null) throw new Error(`review group ${id} is not mounted`);
  return group as HTMLElement;
};

let fetchSpy: ReturnType<typeof vi.fn>;

/** jsdom has no PointerEvent, so Base UI controls dispatch through this. */
class TestPointerEvent extends MouseEvent {
  readonly pointerType = "mouse";
  readonly pointerId = 1;
}

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("vacancy publication gate", () => {
  it("blocks publication and guides to the company profile while it is not ready", () => {
    const { rerender } = mountEmployer();
    click("Cargar vacante válida");
    click("Ir a revisar");
    rerender(withFormElement());

    // The gate is explicit: the action is unavailable and the rail explains why
    // with one semantic link to the company profile.
    expect(
      screen.getByRole("button", { name: "Publicar vacante" }),
    ).toBeDisabled();
    expect(screen.getByText(/completa el perfil de tu empresa/i)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /perfil de empresa/i }),
    ).toHaveAttribute("href", "/empresa/sitio");
    // Nothing was published, and the draft surface stays on review.
    expect(screen.queryByRole("status")).toBeNull();
    expect(stepRegion()).toHaveAttribute("data-pf-step-region", "review");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("publishes in this session when the vacancy is valid and the profile is ready", () => {
    const { rerender } = mountEmployer();
    click("Cargar vacante válida");
    click("Guardar historia");
    click("Confirmar nombre");
    click("Ir a revisar");
    rerender(withFormElement());

    const publish = screen.getByRole("button", { name: "Publicar vacante" });
    expect(publish).toBeEnabled();
    const href = window.location.href;
    fireEvent.click(publish);

    // The outcome is a creation-surface status only: no navigation, no request.
    expect(screen.getByRole("status")).toHaveTextContent(
      "La vacante quedó publicada.",
    );
    expect(screen.queryByText(/completa el perfil de tu empresa/i)).toBeNull();
    expect(stepRegion()).toHaveAttribute("data-pf-step-region", "review");
    expect(window.location.href).toBe(href);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes an incomplete vacancy to its first invalid step instead of publishing", () => {
    const { rerender } = mountEmployer();
    click("Cargar vacante válida");
    click("Vaciar descripción");
    click("Guardar historia");
    click("Confirmar nombre");
    click("Ir a revisar");
    rerender(withFormElement());

    fireEvent.click(screen.getByRole("button", { name: "Publicar vacante" }));

    // The retained contract validation runs before the publication gate.
    expect(stepRegion()).toHaveAttribute("data-pf-step-region", "role-profile");
    expect(
      screen.getByText("Ingresa una descripción para la vacante."),
    ).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("independent draft action", () => {
  it("keeps Guardar borrador enabled and independent from company readiness", () => {
    const { rerender } = mountEmployer();
    click("Cargar vacante válida");
    click("Ir a revisar");
    rerender(withFormElement());

    // The company profile is still incomplete: publishing is blocked, drafting
    // is not.
    const draft = screen.getByRole("button", { name: "Guardar borrador" });
    expect(draft).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Publicar vacante" }),
    ).toBeDisabled();

    fireEvent.click(draft);

    // Saving a draft neither publishes nor raises the profile gate.
    expect(screen.queryByRole("status")).toBeNull();
    expect(stepRegion()).toHaveAttribute("data-pf-step-region", "review");
    expect(draft).toBeEnabled();
  });
});

describe("form-consumer retention", () => {
  it("retains both value sets and the wizard step across a form-consumer remount", () => {
    const { rerender } = mountEmployer();
    click("Cargar vacante válida");
    click("Cargar departamento");
    click("Ir a revisar");

    rerender(withFormElement());
    expect(stepRegion()).toHaveAttribute("data-pf-step-region", "review");
    expect(
      within(reviewGroup("basic-information")).getByText(
        "Backend Developer (Senior)",
      ),
    ).toBeVisible();
    expect(
      within(reviewGroup("basic-information")).getByText("Producto"),
    ).toBeVisible();

    // The creation surface unmounts (a round trip to the company profile) while
    // the employer provider keeps living above it.
    rerender(
      <EmployerSessionProvider>
        <SessionSeed />
      </EmployerSessionProvider>,
    );
    expect(
      screen.queryByRole("button", { name: "Publicar vacante" }),
    ).toBeNull();

    rerender(withFormElement());
    expect(stepRegion()).toHaveAttribute("data-pf-step-region", "review");
    expect(
      within(reviewGroup("basic-information")).getByText(
        "Backend Developer (Senior)",
      ),
    ).toBeVisible();
    expect(
      within(reviewGroup("basic-information")).getByText("Producto"),
    ).toBeVisible();
  });
});
