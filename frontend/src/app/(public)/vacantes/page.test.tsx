import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

type JobsErrorBoundary = React.ComponentType<{
  error: Error & { digest?: string };
  reset: () => void;
}>;
type JobsNavigationIsland = React.ComponentType<{
  children: React.ReactNode;
  routeKey: string;
}>;

async function loadErrorBoundary(): Promise<JobsErrorBoundary> {
  const modulePath = "./error";
  return (await import(/* @vite-ignore */ modulePath))
    .default as JobsErrorBoundary;
}

async function loadNavigationIsland(): Promise<JobsNavigationIsland> {
  const modulePath = "../../../features/jobs/components/JobsNavigationIsland";
  return (await import(/* @vite-ignore */ modulePath))
    .JobsNavigationIsland as JobsNavigationIsland;
}

function NavigationFixture({
  Island,
  routeKey,
}: {
  Island: JobsNavigationIsland;
  routeKey: string;
}) {
  return (
    <Island routeKey={routeKey}>
      <form action="/vacantes?q=pending-search">
        <label>
          Buscar vacantes
          <input />
        </label>
        <button>Buscar</button>
      </form>
      <form action="/vacantes?currency=USD">
        <button>Aplicar filtros</button>
      </form>
      <a href="/vacantes?cursor=opaque">Ver más vacantes</a>
    </Island>
  );
}

    afterEach(() => {
      cleanup();
      push.mockReset();
    });

    describe("/vacantes approved composition", () => {
      const pageSource = readFileSync(
        join(process.cwd(), "src/app/(public)/vacantes/page.tsx"),
        "utf8",
      );

      it("opens with the approved hero: eyebrow, H1, and exact factual support copy", () => {
        const flatSource = pageSource.replace(/\s+/g, " ");
        expect(flatSource).toContain("Bolsa de trabajo");
        expect(flatSource).toContain("Encuentra tu próximo trabajo en tech");
        expect(flatSource).toContain(
          "Explora vacantes publicadas y filtra por modalidad, senioridad, ubicación y moneda.",
        );
        expect(pageSource).not.toMatch(/un clic|tiempo real/i);
      });
    });

    describe("/vacantes synchronous boundaries", () => {
  it("uses a Client route error boundary whose retry calls reset", async () => {
    expect(
      readFileSync(
        join(process.cwd(), "src/app/(public)/vacantes/error.tsx"),
        "utf8",
      ),
    ).toMatch(/['\"]use client['\"]/);
    const ErrorBoundary = await loadErrorBoundary();
    const reset = vi.fn();
    render(<ErrorBoundary error={new Error("upstream")} reset={reset} />);
    expect(screen.getByRole("alert")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /intentar de nuevo/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it.each(["Buscar", "Aplicar filtros"])(
    "announces and isolates pending %s navigation",
    async (label) => {
      const Island = await loadNavigationIsland();
      const view = render(
        <NavigationFixture Island={Island} routeKey="/vacantes" />,
      );
      const initiator = screen.getByRole("button", { name: label });
      fireEvent.click(initiator);
      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(status).toHaveTextContent(/cargando/i);
      expect(initiator).toBeDisabled();
      expect(
        screen.getByRole("button", {
          name: label === "Buscar" ? "Aplicar filtros" : "Buscar",
        }),
      ).toBeEnabled();
      expect(
        screen.getByRole("link", { name: /ver más vacantes/i }),
      ).not.toHaveAttribute("aria-busy", "true");
      expect(push).toHaveBeenCalledWith(
        label === "Buscar"
          ? "/vacantes?q=pending-search"
          : "/vacantes?currency=USD",
      );
      view.rerender(
        <NavigationFixture Island={Island} routeKey={`/vacantes?${label}`} />,
      );
      expect(status).not.toHaveTextContent(/cargando/i);
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    },
  );

  it("makes only the next link busy while retaining surrounding controls", async () => {
    const Island = await loadNavigationIsland();
    render(<NavigationFixture Island={Island} routeKey="/vacantes" />);
    const next = screen.getByRole("link", { name: /ver más vacantes/i });
    fireEvent.click(next);
    expect(screen.getByRole("status")).toHaveTextContent(/cargando/i);
    expect(next).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Buscar" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Aplicar filtros" }),
    ).toBeEnabled();
    expect(push).toHaveBeenCalledWith("/vacantes?cursor=opaque");
  });
});
