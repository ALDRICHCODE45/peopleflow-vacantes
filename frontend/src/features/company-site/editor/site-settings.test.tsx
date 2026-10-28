import { readFileSync } from "node:fs";
import styles from "./site-settings.module.css";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { PALETTE_PRESETS } from "../palettes";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { BrandSettings, SiteSettings } from "./site-settings";
import { defaultSiteDraft } from "../defaults";
import { publishedFixture } from "../public/fixtures.test-support";
import { slugAvailabilityAction } from "../api/actions";
import type { SiteDraft } from "../model";
vi.mock("../api/actions", () => ({ slugAvailabilityAction: vi.fn() }));
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
// Base UI forwards clicks to its native radio using PointerEvent (absent in jsdom).
beforeEach(() => vi.stubGlobal("PointerEvent", MouseEvent));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
function Harness({ brand = false }: { brand?: boolean }) {
  const [draft, update] = useState(defaultSiteDraft());
  const set = (patch: Partial<SiteDraft>) => update(current => ({ ...current, ...patch }));
  return brand ? <BrandSettings theme={draft.theme} onChange={theme => set({ theme })} /> : <SiteSettings draft={draft} company={publishedFixture().company} onSlug={slug => set({ slug })} onSeo={seo => set({ seo })} />;
}
it("shows original and adjusted brand color while keeping the chosen hex", () => {
  render(<Harness brand />);
  fireEvent.change(screen.getByLabelText("Principal"), { target: { value: "#FFFF00" } });
  expect(screen.getByRole("status", { name: "Ajustes de Principal" })).toHaveTextContent("Ajustamos el tono para que el texto se lea bien");
  expect(screen.getByRole("status", { name: "Ajustes de Principal" })).toHaveTextContent(/#FFFF00 → #[0-9A-F]{6}/);
  expect(screen.getByLabelText("Principal")).toHaveValue("#FFFF00");
  fireEvent.change(screen.getByLabelText("Principal"), { target: { value: "nope" } });
  expect(screen.getByText("Usa un color hexadecimal de seis dígitos.")).toBeVisible();
});
it("uses contained two-column palette cards with a narrow-panel fallback", () => {
  render(<Harness brand />);
  const grid = screen.getByRole("radiogroup", { name: "Paletas" });
  expect(grid).toHaveClass(styles.paletteGrid, "min-w-0");
  expect(grid.parentElement).toHaveClass(styles.paletteContainer);
  for (const radio of within(grid).getAllByRole("radio")) {
    expect(radio.closest('[data-slot="field-label"]')).toHaveClass("min-w-0", "box-border");
  }
  const css = readFileSync("src/features/company-site/editor/site-settings.module.css", "utf8");
  expect(css).toMatch(/container-type:\s*inline-size/);
  expect(css).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  expect(css).toMatch(/@container[^\n]*\(max-width:\s*17rem\)/);
  expect(css).not.toMatch(/(?:^|[;{])\s*width:\s*\d+(?:px|rem)/m);
});
it("selects a palette with three swatches and fills all three color inputs", () => {
  const { container } = render(<Harness brand />);
  for (const preset of PALETTE_PRESETS) {
    const radio = screen.getByRole("radio", { name: preset.name });
    expect(radio.closest('[data-slot="field-label"]')?.querySelectorAll('[data-palette-swatch]')).toHaveLength(3);
    fireEvent.click(radio);
    expect(radio).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Principal")).toHaveValue(preset.brand_color);
    expect(screen.getByLabelText("Acento/CTA")).toHaveValue(preset.accent_color);
    expect(screen.getByLabelText("Fondo")).toHaveValue(preset.background_color);
  }
  expect(container.querySelector('[data-slot="radio-group"]')).toHaveAccessibleName("Paletas");
});
it.each(["Principal", "Acento/CTA", "Fondo"])("switches to Personalizado on any edit of %s, retaining invalid text locally", label => {
  render(<Harness brand />);
  fireEvent.click(screen.getByRole("radio", { name: "Violeta" }));
  fireEvent.change(screen.getByLabelText(label), { target: { value: "#aabbcc" } });
  expect(screen.getByRole("radio", { name: "Personalizado" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText(label)).toHaveValue("#AABBCC");
  fireEvent.click(screen.getByRole("radio", { name: "Violeta" }));
  fireEvent.change(screen.getByLabelText(label), { target: { value: "#" } });
  expect(screen.getByRole("radio", { name: "Personalizado" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText(label)).toHaveValue("#");
  expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
});
it("uses native radio arrow navigation to select the next palette", async () => {
  const user = userEvent.setup();
  render(<Harness brand />);
  const first = screen.getByRole("radio", { name: "Violeta" });
  await user.click(first);
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "Océano" })).toHaveFocus();
  expect(screen.getByRole("radio", { name: "Océano" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText("Fondo")).toHaveValue(PALETTE_PRESETS[1].background_color);
});
it("offers three real font samples with a single selected pair", () => {
  render(<Harness brand />);
  for (const name of ["Clásica", "Editorial", "Moderna"]) expect(screen.getByRole("button", { name })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Editorial" }));
  expect(screen.getByRole("button", { name: "Editorial" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Clásica" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Editorial" })).toHaveAttribute("data-font-pair", "editorial");
});
it.each([[true, null, "Disponible"], [false, "taken", "En uso"], [false, "reserved", "Reservada"], [false, "invalid", "Inválida"]] as const)("normalizes and politely announces availability %s/%s", async (available, reason, label) => {
  vi.useFakeTimers(); vi.mocked(slugAvailabilityAction).mockResolvedValue({ kind: "success", data: { slug: "nexo-labs", available, reason } });
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value: "Néxo Labs" } });
  fireEvent.blur(screen.getByLabelText("Dirección pública"));
  expect(screen.getByLabelText("Dirección pública")).toHaveValue("nexo-labs");
  expect(screen.getByRole("status", { name: "Disponibilidad de dirección" })).toHaveTextContent("Verificando");
  await act(() => vi.advanceTimersByTimeAsync(350));
  expect(slugAvailabilityAction).toHaveBeenCalledExactlyOnceWith("nexo-labs");
  expect(screen.getByRole("status", { name: "Disponibilidad de dirección" })).toHaveTextContent(label);
  expect(screen.getByRole("status", { name: "Disponibilidad de dirección" })).toHaveAttribute("aria-live", "polite");
});
it.each([["admin", "Reservada"], ["ab", "Inválida"]])("rejects local %s without a request", async (value, label) => {
  vi.useFakeTimers(); render(<Harness />);
  fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value } });
  await act(() => vi.advanceTimersByTimeAsync(350));
  expect(screen.getByRole("status", { name: "Disponibilidad de dirección" })).toHaveTextContent(label);
  expect(slugAvailabilityAction).not.toHaveBeenCalled();
});
it("ignores stale availability responses and reports a failed check honestly", async () => {
  vi.useFakeTimers(); let resolve!: (value: Awaited<ReturnType<typeof slugAvailabilityAction>>) => void;
  vi.mocked(slugAvailabilityAction).mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue({ kind: "uncertain" });
  render(<Harness />); fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value: "first" } });
  await act(() => vi.advanceTimersByTimeAsync(350));
  fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value: "second" } });
  await act(() => vi.advanceTimersByTimeAsync(350));
  await act(async () => resolve({ kind: "success", data: { slug: "first", available: true, reason: null } }));
  expect(screen.getByRole("status", { name: "Disponibilidad de dirección" })).toHaveTextContent("No pudimos verificar");
});
it.each([[false, "taken"], [false, "reserved"], [false, "invalid"], [true, null]] as const)("dispatches a normalized slug only after availability accepts it (%s/%s)", async (available, reason) => {
  vi.useFakeTimers(); const onSlug = vi.fn();
  vi.mocked(slugAvailabilityAction).mockResolvedValue({ kind: "success", data: { slug: "otra-empresa", available, reason } });
  render(<SiteSettings draft={defaultSiteDraft()} company={publishedFixture().company} onSlug={onSlug} onSeo={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value: "Ótra Empresa" } });
  expect(onSlug).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(350));
  if (available) expect(onSlug).toHaveBeenCalledExactlyOnceWith("otra-empresa");
  else expect(onSlug).not.toHaveBeenCalled();
});
it.each(["admin", "ab", ""])("keeps invalid or empty %j local without changing the draft", async value => {
  vi.useFakeTimers(); const onSlug = vi.fn(); const draft = { ...defaultSiteDraft(), slug: "nexo" };
  render(<SiteSettings draft={draft} company={publishedFixture().company} onSlug={onSlug} onSeo={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value } });
  await act(() => vi.advanceTimersByTimeAsync(350)); expect(onSlug).not.toHaveBeenCalled();
});
it("accepts a return to the saved slug without an availability request", async () => {
  vi.useFakeTimers(); const onSlug = vi.fn(); const draft = { ...defaultSiteDraft(), slug: "accepted-but-unsaved" };
  render(<SiteSettings draft={draft} savedSlug="nexo" company={publishedFixture().company} onSlug={onSlug} onSeo={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value: "Néxo" } });
  await act(() => vi.advanceTimersByTimeAsync(350)); expect(onSlug).toHaveBeenCalledExactlyOnceWith("nexo");
  expect(slugAvailabilityAction).not.toHaveBeenCalled();
});
it("updates Unicode SEO counters and search snippet", () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Título SEO"), { target: { value: "Equipo 😀" } });
  fireEvent.change(screen.getByLabelText("Descripción SEO"), { target: { value: "Ven a crear" } });
  expect(screen.getByText("8/60 caracteres")).toBeVisible(); expect(screen.getByText("11/160 caracteres")).toBeVisible();
  const snippet = screen.getByRole("region", { name: "Vista previa en Google" });
  expect(within(snippet).getByText("Equipo 😀")).toBeVisible(); expect(within(snippet).getByText("Ven a crear")).toBeVisible();
});
it("shows profile identity and links to the real company settings route", () => {
  render(<Harness />);
  const summary = screen.getByRole("region", { name: "Datos de la empresa" });
  expect(within(summary).getByText(publishedFixture().company.name)).toBeVisible();
  expect(within(summary).getByRole("link", { name: /Editar en Configuración de la empresa/ })).toHaveAttribute("href", "/empresa/configuracion");
  expect(screen.getByText(/la dirección anterior redirige/i)).toBeVisible();
});
