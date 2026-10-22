import { useState, type ReactNode } from "react";
// Match geo tests: replace jsdom's looping anchored positioner, not input/selection.
vi.mock("@/components/ui/combobox", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/combobox")>(),
  ComboboxContent: ({ children }: { children: ReactNode }) => <div data-slot="combobox-content">{children}</div>,
}));
vi.mock("@/components/ui/select", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/select")>(),
  SelectContent: ({ children }: { children: ReactNode }) => <div data-slot="select-content">{children}</div>,
}));
// jsdom has no layout for the anchored tooltip positioner; preserve its real root/trigger.
vi.mock("@/components/ui/tooltip", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/tooltip")>(),
  TooltipContent: ({ children }: { children: ReactNode }) => <div role="tooltip">{children}</div>,
}));
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageListEditor } from "@/features/languages/language-field";
import type { CandidateLanguageDraft } from "@/features/candidate/profile-draft";
vi.mock("./use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "es", name: "Español" }, { code: "local:any", name: "Mixteco" }] }, retry: vi.fn() }) }));
afterEach(cleanup);
function Editor() { const [value, setValue] = useState<readonly CandidateLanguageDraft[]>([]); return <><LanguageListEditor value={value} onChange={setValue} /><output aria-label="Valores">{JSON.stringify(value)}</output></>; }
it("searches Spanish names, stores opaque codes, prevents duplicates and removes rows", async () => {
  const user = userEvent.setup(); render(<Editor />);
  expect(screen.getByText("Sin idiomas agregados.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Agregar idioma" }));
  await user.type(screen.getByRole("combobox", { name: "Idioma 1" }), "Mix");
  await user.click(await screen.findByRole("option", { name: "Mixteco" }));
  expect(screen.getByRole("status", { name: "Valores" }).textContent).toContain('"code":"local:any"');
  await user.click(screen.getByRole("combobox", { name: "Nivel del idioma 1" }));
  for (const label of ["A1 · Principiante", "A2 · Básico", "B1 · Intermedio", "B2 · Intermedio alto", "C1 · Avanzado", "C2 · Dominio", "Nativo"]) expect(await screen.findByRole("option", { name: label })).toBeTruthy();
  await user.click(screen.getByRole("option", { name: "Nativo" }));
  await user.click(screen.getByRole("button", { name: "Agregar idioma" }));
  await user.type(screen.getByRole("combobox", { name: "Idioma 2" }), "Mix");
  await waitFor(() => expect(within(screen.getByRole("group", { name: "Idioma 2" })).queryByRole("option", { name: "Mixteco" })).toBeNull());
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Quitar idioma 1" }));
  expect(screen.getByRole("status", { name: "Valores" }).textContent).not.toContain("local:any");
});
it("overrides the vacancy limit and gives each minimum level a unique name", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ code: String(i), level: "A1" as const }));
  const { rerender } = render(<LanguageListEditor value={rows.slice(0, 10)} onChange={vi.fn()} maxItems={20} levelLabel="Nivel mínimo del idioma" />);
  expect((screen.getByRole("button", { name: "Agregar idioma" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("combobox", { name: "Nivel mínimo del idioma 1" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Nivel mínimo del idioma 10" })).toBeTruthy();
  rerender(<LanguageListEditor value={rows} onChange={vi.fn()} maxItems={20} levelLabel="Nivel mínimo del idioma" />);
  expect((screen.getByRole("button", { name: "Agregar idioma" }) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps language, level and icon removal in one responsive row, with dividers and a tooltip", async () => {
  const user = userEvent.setup();
  const { container } = render(<LanguageListEditor value={[{ code: "es", level: "B2" }, { code: "", level: "" }]} onChange={vi.fn()} />);
  const remove = screen.getByRole("button", { name: "Quitar idioma 1" });
  expect(remove.textContent).toBe("");
  expect(remove.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  const grid = remove.closest('[data-pf-profile-language-grid]');
  expect(grid?.contains(screen.getByLabelText("Idioma 1"))).toBe(true);
  expect(grid?.contains(screen.getByLabelText("Nivel del idioma 1"))).toBe(true);
  expect(grid?.className).toContain("sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]");
  expect(container.querySelectorAll('[data-slot="separator"]')).toHaveLength(1);
  await user.hover(remove);
  expect(screen.getAllByRole("tooltip")[0]).toHaveProperty("textContent", "Quitar");
});
it("disables adding at ten languages", () => {
  render(<LanguageListEditor value={Array.from({ length: 10 }, (_, i) => ({ code: String(i), level: "A1" }))} onChange={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Agregar idioma" }) as HTMLButtonElement).disabled).toBe(true);
});
it("asks to choose a level for each language instead of offering «Sin especificar» (the level is required)", () => {
  render(<LanguageListEditor value={[{ code: "", level: "" }]} onChange={vi.fn()} />);
  expect(screen.queryByText("Sin especificar")).toBeNull();
  expect(screen.getByLabelText("Nivel del idioma 1").textContent).toContain("Elige un nivel");
});
