import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BoardLifecycle } from "./board-lifecycle";
import { boardFixture } from "./board-fixture";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";

// S5/S6: the date lines under «Pipeline». A replacement's clock counts from the process start, so that date stays even once the listing is public.
afterEach(cleanup);
const started = "2026-11-19T18:00:00Z";
const publicAt = "2026-11-21T12:00:00Z";
const base = (extra: Partial<Lifecycle>): Lifecycle => ({ ...boardFixture().lifecycle, publication: "published", process: "active", published_at: started, paused_at: null, closed_at: null, process_finished_at: null, close_reason: null, close_reason_note: null, ...extra });
const replacement = (extra: Partial<Lifecycle> = {}) => base({ kind: "replacement", sequence: 1, replacement_of: "223e4567-e89b-42d3-a456-426614174000", ...extra });

it("a private replacement says «Proceso iniciado el …» and «Privada · sin publicar», no publication date", () => {
  render(<BoardLifecycle lifecycle={replacement({ visibility: "private" })} publishedAt={null} />);
  expect(screen.getByText(/Proceso iniciado el/)).toHaveTextContent("Proceso iniciado el 19 nov 2026");
  expect(screen.getByText("Privada · sin publicar")).toBeVisible();
  expect(screen.queryByText(/Publicada el/)).not.toBeInTheDocument();
});
it("a public replacement keeps «Proceso iniciado el <inicio>» and adds «Publicada el <publicación>» beside it", () => {
  render(<BoardLifecycle lifecycle={replacement({ visibility: "public" })} publishedAt={publicAt} />);
  expect(screen.getByText(/Proceso iniciado el/)).toHaveTextContent("Proceso iniciado el 19 nov 2026");
  expect(screen.getByText(/Publicada el/)).toHaveTextContent("Publicada el 21 nov 2026");
  expect(screen.queryByText("Privada · sin publicar")).not.toBeInTheDocument();
  expect(screen.getByText(/Proceso iniciado el/).parentElement).toContainElement(screen.getByText(/Publicada el/));
});
it("a public replacement whose publication date is not known yet shows only the start", () => {
  render(<BoardLifecycle lifecycle={replacement({ visibility: "public" })} publishedAt={null} />);
  expect(screen.getByText(/Proceso iniciado el/)).toHaveTextContent("19 nov 2026");
  expect(screen.queryByText(/Publicada el/)).not.toBeInTheDocument();
});
it("an original is unchanged: «Publicada el <lifecycle.published_at>», never «Proceso iniciado»", () => {
  render(<BoardLifecycle lifecycle={base({ kind: "original", visibility: "public" })} publishedAt={publicAt} />);
  expect(screen.getByText(/Publicada el/)).toHaveTextContent("Publicada el 19 nov 2026");
  expect(screen.queryByText(/Proceso iniciado el/)).not.toBeInTheDocument();
});
it("an old backend payload (no kind) is unchanged", () => {
  render(<BoardLifecycle lifecycle={base({})} publishedAt={null} />);
  expect(screen.getByText(/Publicada el/)).toHaveTextContent("Publicada el 19 nov 2026");
});
it("a closed replacement keeps the closing date line", () => {
  render(<BoardLifecycle lifecycle={replacement({ visibility: "public", publication: "closed", close_reason: "filled", closed_at: "2026-11-25T12:00:00Z" })} publishedAt={publicAt} />);
  expect(screen.getByText(/Cerrada el/)).toHaveTextContent("Cerrada el 25 nov 2026");
  expect(screen.queryByText(/Proceso iniciado el/)).not.toBeInTheDocument();
});

// S8: the closed header reason reads «Cubierta al cierre» when today's coverage fell below the required places.
const closedFilled = (extra: Partial<Lifecycle> = {}) => base({ publication: "closed", process: "active", close_reason: "filled", closed_at: "2026-11-20T12:00:00Z", ...extra });
it.each([
  [{ covered: 1, required: 2 }, "Motivo de cierre: Cubierta al cierre"],
  [{ covered: 2, required: 2 }, "Motivo de cierre: Cubierta"],
  [{ covered: 0, required: null }, "Motivo de cierre: Cubierta"],
  [undefined, "Motivo de cierre: Cubierta"],
] as const)("closed as filled with coverage %j shows «%s»", (coverage, text) => {
  render(<BoardLifecycle lifecycle={closedFilled()} coverage={coverage} />);
  expect(screen.getByText(/Motivo de cierre/)).toHaveTextContent(new RegExp(`^${text}$`));
});
it("a closed cancelled vacancy keeps «Cancelada» even with low coverage", () => {
  render(<BoardLifecycle lifecycle={closedFilled({ close_reason: "cancelled" })} coverage={{ covered: 0, required: 2 }} />);
  expect(screen.getByText(/Motivo de cierre/)).toHaveTextContent(/^Motivo de cierre: Cancelada$/);
});
