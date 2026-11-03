import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("@/components/ui/dropdown-menu", async () => (await import("@/components/data-table/test-menu")).menuDouble);
vi.mock("@/components/ui/tooltip", async () => (await import("@/components/data-table/test-menu")).tooltipDouble);
vi.mock("./action-client", () => ({ createApiClient: () => ({ getHistory: async () => ({ items: [], next_cursor: null }) }) }));
import { AssignmentHistoryPage } from "./page";
afterEach(() => { cleanup(); vi.unstubAllEnvs(); window.history.replaceState(null, "", "/"); });
it.each(["1", "api", undefined])("selects the %s opt-in without enabling hidden mode", async flag => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", flag);
  window.history.replaceState(null, "", "/?state=error");
  const { container } = render(<AssignmentHistoryPage />);
  if (flag === "api") expect(await screen.findByText("Todavía no has trabajado en vacantes")).toBeTruthy();
  else if (flag === "1") expect(await screen.findByText("No pudimos cargar tu historial")).toBeTruthy();
  else expect(container.textContent).toBe("");
});
