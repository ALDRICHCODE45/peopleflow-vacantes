import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";

import type { JobsQuery } from "../../../features/jobs/url";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

type JobsErrorBoundary = React.ComponentType<{
  error: Error & { digest?: string };
  reset: () => void;
}>;
type JobsNavigationIsland = React.ComponentType<{
  children: React.ReactNode;
  routeKey: string;
  query?: JobsQuery;
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
      <Link href="/vacantes?cursor=opaque">Ver más vacantes</Link>
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

  const vacancyList = <ul aria-label="Listado de vacantes" />;

  async function loadFullIsland(): Promise<JobsNavigationIsland> {
    return (
      await import(
        /* @vite-ignore */ "../../../features/jobs/components/JobsNavigationIsland"
      )
    ).JobsNavigationIsland as JobsNavigationIsland;
  }

  it("renders the results heading and only the supported quick chips", async () => {
    const Island = await loadFullIsland();
    render(
      <Island routeKey="/vacantes" query={{}}>
        {vacancyList}
      </Island>,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Vacantes disponibles" }),
    ).toBeVisible();
    for (const label of [
      "Todas",
      "Remoto",
      "Híbrido",
      "Tiempo completo",
      "Medio",
      "Senior",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
    expect(
      screen.queryByRole("button", {
        name: /prácticas|presencial|por contrato|beca|líder|junior/i,
      }),
    ).toBeNull();
  });

  it("shows quick chip state honestly: full reset only when the query is empty", async () => {
    const Island = await loadFullIsland();
    const filtered = render(
      <Island routeKey="/vacantes?currency=MXN" query={{ currency: "MXN" }}>
        {vacancyList}
      </Island>,
    );
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    filtered.unmount();

    render(
      <Island routeKey="/vacantes" query={{}}>
        {vacancyList}
      </Island>,
    );
    expect(screen.getByRole("button", { name: "Todas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("commits quick chips through the canonical scalar navigation pipeline", async () => {
    const Island = await loadFullIsland();
    render(
      <Island routeKey="/vacantes?currency=MXN" query={{ currency: "MXN" }}>
        {vacancyList}
      </Island>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remoto" }));
    expect(push).toHaveBeenCalledWith(
      "/vacantes?work_mode=remote&currency=MXN",
    );
  });

  it("resets every filter through the Todas chip, cursor included", async () => {
    const Island = await loadFullIsland();
    render(
      <Island
        routeKey="/vacantes?q=react&currency=MXN&work_mode=remote"
        query={{ q: "react", currency: "MXN", work_mode: "remote" }}
      >
        {vacancyList}
      </Island>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(push).toHaveBeenCalledWith("/vacantes");
  });

  it("keeps the composed search honest about what q and location match", async () => {
    const Island = await loadFullIsland();
    const view = render(
      <Island routeKey="/vacantes" query={{}}>
        {vacancyList}
      </Island>,
    );

    const searchForm = view.container.querySelector<HTMLFormElement>(
      'form[data-nav-intent="search"]',
    );
    expect(searchForm).not.toBeNull();
    const q = within(searchForm!).getByLabelText("Buscar vacantes");
    expect(q).toHaveAttribute("placeholder", "Puesto o palabra clave");
    expect(q.getAttribute("placeholder")).not.toMatch(/tecnolog|empresa/i);
    const location = within(searchForm!).getByLabelText("Ubicación");
    expect(location).toHaveAttribute("placeholder", "Ciudad o estado");
    expect(
      within(searchForm!).getByRole("button", { name: "Buscar" }),
    ).toBeVisible();
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
