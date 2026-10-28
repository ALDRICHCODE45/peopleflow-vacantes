import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "../browser-platform.test-support";
import { IconPicker, type Decoration } from "./icon-picker";
import { ICONS, emojiError } from "../../model";
import { ICON_LABELS, ICON_GROUPS, EMOJI_GROUPS } from "./catalog";
vi.mock("@/components/ui/popover", async original => {
  const parts = await original<typeof import("@/components/ui/popover")>();
  return { ...parts, PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});
afterEach(cleanup);
function mount() {
  function Harness() {
    const [value, setValue] = useState<Decoration>({ icon: "heart", emoji: null });
    return <><IconPicker value={value} onChange={setValue} /><output>{JSON.stringify(value)}</output></>;
  }
  return render(<Harness />);
}
it("covers all icons with Spanish labels and exactly one category", () => {
  expect(Object.keys(ICON_LABELS).sort()).toEqual([...ICONS].sort());
  expect(ICON_GROUPS.flatMap(group => group.icons).sort()).toEqual([...ICONS].sort());
  const emojis = EMOJI_GROUPS.flatMap(group => group.items);
  expect(emojis.length).toBeGreaterThanOrEqual(115);
  expect(emojis.length).toBeLessThanOrEqual(130);
  for (const item of emojis) expect(emojiError(item.emoji)).toBeNull();
});
it("searches icons without accents and selects exclusively", () => {
  mount();
  fireEvent.click(screen.getByLabelText("Ícono o emoji"));
  fireEvent.change(screen.getByLabelText("Buscar íconos"), { target: { value: "proteccion" } });
  expect(screen.getByRole("option", { name: "Protección" })).toHaveAttribute("aria-selected", "false");
  expect(screen.queryByRole("option", { name: "Cohete" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: "Protección" }));
  expect(screen.getByRole("status")).toHaveTextContent('"icon":"shield","emoji":null');
});
it("switches tabs, searches Spanish emoji keywords and selects", () => {
  mount();
  fireEvent.click(screen.getByRole("tab", { name: "Emojis" }));
  expect(screen.getByRole("tab", { name: "Emojis" })).toHaveAttribute("aria-selected", "true");
  fireEvent.change(screen.getByLabelText("Buscar emojis"), { target: { value: "programacion" } });
  fireEvent.click(screen.getByRole("option", { name: "Tecnóloga" }));
  expect(screen.getByRole("status")).toHaveTextContent('"icon":null,"emoji":"👩‍💻"');
});
it("validates pasted emoji live without changing the draft until valid", () => {
  mount();
  fireEvent.click(screen.getByRole("tab", { name: "Emojis" }));
  const paste = screen.getByLabelText("Pega tu emoji");
  for (const value of ["ab", "😀😀", "😀\u0301", "a".repeat(33)]) {
    fireEvent.change(paste, { target: { value } });
    expect(paste).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/tú/);
    expect(screen.getByRole("button", { name: "Usar emoji" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent('"icon":"heart"');
  }
  fireEvent.change(paste, { target: { value: "👍🏽" } });
  expect(paste).toHaveAttribute("aria-invalid", "false");
  fireEvent.click(screen.getByRole("button", { name: "Usar emoji" }));
  expect(screen.getByRole("status")).toHaveTextContent('"icon":null,"emoji":"👍🏽"');
});
