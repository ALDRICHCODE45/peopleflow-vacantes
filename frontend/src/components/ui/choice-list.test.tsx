import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { ChoiceList, type ChoiceOption } from "./choice-list";

beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); }); // Base UI radios read it; jsdom has none
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const DEST: ChoiceOption[] = [
  { value: "vacancy", title: "La vacante", description: "Contratos y solicitudes del cliente" },
  { value: "candidate", title: "Una persona candidata", description: "Carta de renuncia y alta IMSS" },
];
const PEOPLE: ChoiceOption[] = [
  { value: "ric", title: "Ricardo Morales", meta: "Se fue el 17 nov" },
  { value: "dan", title: "Daniela Ibarra", meta: "Se fue el 19 nov" },
  { value: "lui", title: "Luis Ochoa", meta: "Se fue el 20 nov" },
  { value: "mar", title: "Mariana Cavazos", disabled: true, disabledReason: "Sigue en Placement." },
];

function Single({ options = DEST, initial = null, error }: { options?: ChoiceOption[]; initial?: string | null; error?: string }) {
  const [value, setValue] = useState<string | null>(initial);
  return <ChoiceList legend="¿A quién pertenece?" value={value} onValueChange={setValue} options={options} error={error} />;
}
function Multi({ initial = [], options = PEOPLE, selectAll }: { initial?: string[]; options?: ChoiceOption[]; selectAll?: boolean }) {
  const [value, setValue] = useState<string[]>(initial);
  return <ChoiceList multiple legend="Bajas" value={value} onValueChange={setValue} options={options} selectAll={selectAll} />;
}

describe("single (radio semantics)", () => {
  it("is a named radiogroup of radios named by their title, with aria-checked", () => {
    render(<Single initial="vacancy" />);
    const group = screen.getByRole("radiogroup", { name: "¿A quién pertenece?" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map(radio => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(within(group).getByRole("radio", { name: "La vacante" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Una persona candidata" })).not.toBeChecked();
  });
  it("selects with a click anywhere on the row, including the description", async () => {
    const user = userEvent.setup();
    render(<Single initial="vacancy" />);
    await user.click(screen.getByText("Carta de renuncia y alta IMSS"));
    expect(screen.getByRole("radio", { name: "Una persona candidata" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "La vacante" })).not.toBeChecked();
  });
  it("moves the selection with the arrow keys and a single tab stop", async () => {
    const user = userEvent.setup();
    render(<Single initial="vacancy" />);
    await user.tab();
    expect(screen.getByRole("radio", { name: "La vacante" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Una persona candidata" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Una persona candidata" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("radio", { name: "La vacante" })).toBeChecked();
  });
  it("describes a disabled option with its visible reason and does not select it", async () => {
    const user = userEvent.setup();
    render(<Single initial="candidate" options={[{ ...DEST[0], disabled: true, disabledReason: "Esta vacante llegó al límite." }, DEST[1]]} />);
    const radio = screen.getByRole("radio", { name: "La vacante" });
    expect(radio).toHaveAttribute("aria-disabled", "true");
    expect(radio).toHaveAccessibleDescription(expect.stringContaining("Esta vacante llegó al límite."));
    expect(screen.getByText("Esta vacante llegó al límite.")).toBeVisible();
    await user.click(radio);
    expect(radio).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Una persona candidata" })).toBeChecked();
  });
  it("marks the group invalid and announces the error", () => {
    render(<Single error="Elige a quién pertenece el documento." />);
    const group = screen.getByRole("radiogroup", { name: "¿A quién pertenece?" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Elige a quién pertenece el documento.");
    expect(group).toHaveAccessibleDescription("Elige a quién pertenece el documento.");
  });
  it("keeps 40 px+ rows and a focus ring distinct from the selection bar", () => {
    render(<Single initial="vacancy" />);
    const row = screen.getByRole("radio", { name: "La vacante" });
    expect(row.className).toMatch(/min-h-1[0-9]|min-h-\[?(4|5|6)/);
    expect(row.className).toContain("focus-visible:outline-primary-text");
    expect(row.className).toContain("before:bg-selection");
  });
});

describe("multiple (checkbox semantics)", () => {
  it("is a named group of checkboxes with aria-checked and whole-row toggling", async () => {
    const user = userEvent.setup();
    render(<Multi initial={["ric"]} />);
    const group = screen.getByRole("group", { name: "Bajas" });
    expect(within(group).getByRole("checkbox", { name: "Ricardo Morales" })).toBeChecked();
    expect(within(group).getByRole("checkbox", { name: "Daniela Ibarra" })).not.toBeChecked();
    await user.click(screen.getByText("Se fue el 19 nov"));
    expect(within(group).getByRole("checkbox", { name: "Daniela Ibarra" })).toBeChecked();
    await user.click(screen.getByText("Se fue el 17 nov"));
    expect(within(group).getByRole("checkbox", { name: "Ricardo Morales" })).not.toBeChecked();
  });
  it("toggles with the space key", async () => {
    const user = userEvent.setup();
    render(<Multi selectAll={false} />);
    await user.tab();
    const first = screen.getByRole("checkbox", { name: "Ricardo Morales" });
    expect(first).toHaveFocus();
    await user.keyboard(" ");
    expect(first).toBeChecked();
    await user.tab();
    expect(screen.getByRole("checkbox", { name: "Daniela Ibarra" })).toHaveFocus();
  });
  it("shows «Seleccionar todo» first for 3+ options with a none / partial / all state and a count", async () => {
    const user = userEvent.setup();
    render(<Multi initial={[]} />);
    const all = screen.getByRole("checkbox", { name: "Seleccionar todo" });
    expect(screen.getAllByRole("checkbox")[0]).toBe(all);
    expect(all).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Ninguna elegida");
    await user.click(screen.getByRole("checkbox", { name: "Ricardo Morales" }));
    expect(all).toHaveAttribute("aria-checked", "mixed");
    expect(screen.getByRole("status")).toHaveTextContent("1 de 3 elegidas");
    await user.click(all);
    expect(all).toHaveAttribute("aria-checked", "true");
    for (const name of ["Ricardo Morales", "Daniela Ibarra", "Luis Ochoa"]) expect(screen.getByRole("checkbox", { name })).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("3 de 3 elegidas");
    await user.click(all);
    expect(all).toHaveAttribute("aria-checked", "false");
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
  });
  it("select-all skips disabled options and leaves their value alone", async () => {
    const user = userEvent.setup();
    const seen: string[][] = [];
    function Probe() {
      const [value, setValue] = useState<string[]>(["mar"]);
      return <ChoiceList multiple legend="Bajas" value={value} onValueChange={next => { seen.push(next); setValue(next); }} options={PEOPLE} />;
    }
    render(<Probe />);
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar todo" }));
    expect(seen.at(-1)).toEqual(["mar", "ric", "dan", "lui"]);
    expect(screen.getByRole("checkbox", { name: "Mariana Cavazos" })).toHaveAttribute("aria-disabled", "true");
  });
  it("omits «Seleccionar todo» below 3 options or when turned off", () => {
    const { unmount } = render(<Multi options={PEOPLE.slice(0, 2)} />);
    expect(screen.queryByRole("checkbox", { name: "Seleccionar todo" })).toBeNull();
    unmount();
    render(<Multi selectAll={false} />);
    expect(screen.queryByRole("checkbox", { name: "Seleccionar todo" })).toBeNull();
  });
  it("describes a disabled option by its visible reason", () => {
    render(<Multi />);
    const row = screen.getByRole("checkbox", { name: "Mariana Cavazos" });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveAccessibleDescription("Sigue en Placement.");
    expect(screen.getByText("Sigue en Placement.")).toBeVisible();
  });
});
