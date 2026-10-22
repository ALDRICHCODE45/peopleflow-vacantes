import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLanguageCatalog } from "./use-language-catalog";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Consumer() { const catalog = useLanguageCatalog(); return <><output>{catalog.status}</output><button onClick={catalog.retry}>Reintentar</button></>; }
it("deduplicates reads, retains failures across remounts, and only retries explicitly", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(Response.json({ items: [{ code: "local:code", name: "Mixteco" }] }));
  vi.stubGlobal("fetch", fetch);
  const first = render(<Consumer />);
  await screen.findByText("error");
  expect(fetch).toHaveBeenCalledWith("/api/catalogs/languages", expect.objectContaining({ method: "GET", credentials: "omit" }));
  first.unmount(); render(<><Consumer /><Consumer /></>);
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getAllByRole("button", { name: "Reintentar" })[0]);
  await waitFor(() => expect(screen.getAllByText("success")).toHaveLength(2));
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getAllByRole("button", { name: "Reintentar" })[1]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
