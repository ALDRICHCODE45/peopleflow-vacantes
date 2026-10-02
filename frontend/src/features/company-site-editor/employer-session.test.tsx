import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  EmployerSessionProvider,
  useEmployerSession,
} from "./employer-session";

/**
 * Stand-in for the employer routes that read and write through the shared
 * session. It is deliberately dumb: it only exposes setters as buttons and the
 * current values as text, so a remount proves what the provider kept.
 */
function VacancyProbe() {
  const session = useEmployerSession();

  return (
    <div>
      <span data-testid="title">{session.vacancyValues.title}</span>
      <span data-testid="department">{session.prototypeValues.department}</span>
      <span data-testid="step">{session.vacancyStep}</span>
      <button
        type="button"
        onClick={() =>
          session.setVacancyValues((previous) => ({
            ...previous,
            title: "Ingeniero de datos",
          }))
        }
      >
        Guardar título
      </button>
      <button
        type="button"
        onClick={() =>
          session.setPrototypeValues((previous) => ({
            ...previous,
            department: "Ingeniería",
          }))
        }
      >
        Guardar departamento
      </button>
      <button type="button" onClick={() => session.setVacancyStep("review")}>
        Ir a revisar
      </button>
    </div>
  );
}

/** Stand-in for the company editor: it owns the draft and its confirmation. */
function CompanyProbe() {
  const session = useEmployerSession();

  return (
    <div>
      <span data-testid="company-name">{session.profile.draft.name}</span>
      <span data-testid="company-about">{session.profile.draft.about}</span>
      <span data-testid="company-ready">{String(session.profileReady)}</span>
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
      <button
        type="button"
        onClick={() => session.updateCompanyField("name", "Nexo Labs MX")}
      >
        Renombrar empresa
      </button>
    </div>
  );
}

afterEach(cleanup);

describe("EmployerSessionProvider keeps employer work across consumer remounts", () => {
  it("retains the contract values, the complementary values and the wizard step", () => {
    const { rerender } = render(
      <EmployerSessionProvider>
        <VacancyProbe />
      </EmployerSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar título" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar departamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Ir a revisar" }));
    expect(screen.getByTestId("title")).toHaveTextContent("Ingeniero de datos");
    expect(screen.getByTestId("department")).toHaveTextContent("Ingeniería");
    expect(screen.getByTestId("step")).toHaveTextContent("review");

    // The route consumer unmounts (for example, navigating to the company site)
    // while the employer layout and its provider keep living.
    rerender(<EmployerSessionProvider>{null}</EmployerSessionProvider>);
    expect(screen.queryByTestId("title")).toBeNull();

    rerender(
      <EmployerSessionProvider>
        <VacancyProbe />
      </EmployerSessionProvider>,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("Ingeniero de datos");
    expect(screen.getByTestId("department")).toHaveTextContent("Ingeniería");
    expect(screen.getByTestId("step")).toHaveTextContent("review");
  });

  it("retains the company draft and its name confirmation across a remount", () => {
    const { rerender } = render(
      <EmployerSessionProvider>
        <CompanyProbe />
      </EmployerSessionProvider>,
    );

    // The seeded identity starts unconfirmed, so it is not ready to publish.
    expect(screen.getByTestId("company-name")).toHaveTextContent("Nexo Labs");
    expect(screen.getByTestId("company-ready")).toHaveTextContent("false");

    fireEvent.click(screen.getByRole("button", { name: "Guardar historia" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar nombre" }));
    expect(screen.getByTestId("company-ready")).toHaveTextContent("true");

    rerender(<EmployerSessionProvider>{null}</EmployerSessionProvider>);
    rerender(
      <EmployerSessionProvider>
        <CompanyProbe />
      </EmployerSessionProvider>,
    );

    expect(screen.getByTestId("company-about")).toHaveTextContent(
      "Somos un equipo de producto.",
    );
    expect(screen.getByTestId("company-ready")).toHaveTextContent("true");

    // Editing the name revokes the confirmation and closes the gate again.
    fireEvent.click(screen.getByRole("button", { name: "Renombrar empresa" }));
    expect(screen.getByTestId("company-name")).toHaveTextContent("Nexo Labs MX");
    expect(screen.getByTestId("company-ready")).toHaveTextContent("false");
  });
});
