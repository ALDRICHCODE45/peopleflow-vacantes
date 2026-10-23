import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("../actions", () => ({ listCandidatesAction: vi.fn() }));
vi.mock("../summary/summary-actions", () => ({ getCandidatesSummaryAction: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async () => (await import("@/components/data-table/test-menu")).menuDouble);
vi.mock("@/components/ui/tooltip", async () => (await import("@/components/data-table/test-menu")).tooltipDouble);
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "en", name: "Inglés" }] } }) }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ states: { status: "success", data: { items: [] } } }), useGeoResource: () => ({ status: "success", data: { items: [] } }) }));
import { listCandidatesAction } from "../actions";
import { getCandidatesSummaryAction } from "../summary/summary-actions";
import { summary } from "../summary/test-fixtures";
import { detailFixture } from "../detail/test-fixtures";
import { OrgCandidatesWorkspace } from "./list-workspace";
import { page } from "./test-fixtures";

beforeEach(() => {
 vi.resetAllMocks(); localStorage.clear();
 vi.stubGlobal("innerWidth", 1440);
 vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
 window.history.replaceState(null, "", "/empresa/talento");
 vi.mocked(listCandidatesAction).mockResolvedValue({ ok: true, data: page });
 vi.mocked(getCandidatesSummaryAction).mockResolvedValue({ ok: true, data: summary });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows the page heading, the three metrics and origin tabs with counters", async () => {
 render(<OrgCandidatesWorkspace />);
 expect(screen.getByRole("heading", { level: 1, name: "Candidatos de mi organización" })).toBeInTheDocument();
 expect(await screen.findByRole("group", { name: "Total de candidatos" })).toHaveTextContent("8");
 expect(screen.getByRole("group", { name: "En procesos activos" })).toHaveTextContent("7");
 expect(screen.getByRole("group", { name: "Agregados esta semana" })).toHaveTextContent("3");
 const tabs = screen.getByRole("tablist", { name: "Origen de los candidatos" });
 expect(within(tabs).getByRole("tab", { name: /Todos los candidatos/u })).toHaveTextContent("8");
 expect(within(tabs).getByRole("tab", { name: /Agregados por mi equipo/u })).toHaveTextContent("3");
 expect(within(tabs).getByRole("tab", { name: /Todos los candidatos/u })).toHaveAttribute("aria-selected", "true");
});

it("«Agregados por mi equipo» applies the manual origin filter and «Todos» removes it, keeping other filters", async () => {
 window.history.replaceState(null, "", "/empresa/talento?q=Ana");
 render(<OrgCandidatesWorkspace />);
 await screen.findByRole("group", { name: "Total de candidatos" });
 await userEvent.click(screen.getByRole("tab", { name: /Agregados por mi equipo/u }));
 await waitFor(() => expect(new URLSearchParams(window.location.search).get("origin")).toBe("manual"));
 expect(new URLSearchParams(window.location.search).get("q")).toBe("Ana");
 expect(screen.getByRole("tab", { name: /Agregados por mi equipo/u })).toHaveAttribute("aria-selected", "true");
 await userEvent.click(screen.getByRole("tab", { name: /Todos los candidatos/u }));
 await waitFor(() => expect(new URLSearchParams(window.location.search).get("origin")).toBeNull());
 expect(new URLSearchParams(window.location.search).get("q")).toBe("Ana");
});

it("selects the manual tab from the URL origin filter", async () => {
 window.history.replaceState(null, "", "/empresa/talento?origin=manual");
 render(<OrgCandidatesWorkspace />);
 expect(await screen.findByRole("tab", { name: /Agregados por mi equipo/u })).toHaveAttribute("aria-selected", "true");
});

it("a summary failure never blocks the table and can be retried", async () => {
 vi.mocked(getCandidatesSummaryAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} });
 render(<OrgCandidatesWorkspace />);
 expect(await screen.findByText("No pudimos cargar el resumen")).toBeInTheDocument();
 expect(await screen.findByText("Mariana Ortega Silva")).toBeInTheDocument();
 await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
 expect(await screen.findByRole("group", { name: "Total de candidatos" })).toHaveTextContent("8");
});

it("refreshes the summary after a confirmed candidate save", async () => {
 const view = render(<OrgCandidatesWorkspace />);
 await screen.findByRole("group", { name: "Total de candidatos" });
 expect(getCandidatesSummaryAction).toHaveBeenCalledTimes(1);
 vi.mocked(getCandidatesSummaryAction).mockResolvedValueOnce({ ok: true, data: { ...summary, total: 9, by_kind: { manual: 4, organic: 5 } } });
 view.rerender(<OrgCandidatesWorkspace updatedCandidate={detailFixture()} />);
 await waitFor(() => expect(getCandidatesSummaryAction).toHaveBeenCalledTimes(2));
 expect(await screen.findByRole("group", { name: "Total de candidatos" })).toHaveTextContent("9");
});
