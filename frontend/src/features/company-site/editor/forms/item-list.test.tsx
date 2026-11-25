import "../browser-platform.test-support";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ItemList } from "./item-list";
afterEach(cleanup);
it("gives long titles, menu, drag and disclosure their own slots", () => {
  const title = "Seguro médico para ti y toda tu familia sin restricciones";
  render(<ItemList items={[title]} summary={item => item} onChange={() => {}} create={() => ""} min={1} max={5}>{() => <p>Contenido</p>}</ItemList>);
  const copy = screen.getByText(title);
  expect(copy).toHaveAttribute("title", title);
  expect(copy).toHaveClass("line-clamp-2", "break-words");
  const disclosure = screen.getByRole("button", { name: title });
  const menu = screen.getByRole("button", { name: "Acciones de elemento 1" });
  const drag = screen.getByRole("button", { name: "Arrastrar elemento 1" });
  expect(disclosure).toHaveAttribute("aria-expanded", "true");
  expect(menu).toHaveAttribute("aria-haspopup", "menu");
  expect(disclosure).not.toContainElement(menu);
  expect(disclosure).not.toContainElement(drag);
  expect(disclosure).not.toContainElement(copy);
  expect(disclosure.parentElement?.parentElement?.parentElement).toBe(menu.parentElement);
});

function list(onChange = vi.fn(), items = ["Seguro médico", "Horario flexible", "Gimnasio"]) {
  render(<ItemList items={items} summary={item => item} onChange={onChange} create={() => ""} min={1} max={8}>{() => <p>Contenido</p>}</ItemList>);
  return onChange;
}
const announcer = () => document.querySelector("[data-drag-announcer]");
const handle = (n: number) => screen.getByRole("button", { name: `Arrastrar elemento ${n}` });
function keys(target: HTMLElement, ...sequence: string[]) { for (const key of sequence) fireEvent.keyDown(target, { key }); }
describe("keyboard drag", () => {
  it("moves an item with one content change and announces its final position", () => {
    const onChange = list();
    const grip = handle(3); act(() => grip.focus());
    keys(grip, " ");
    expect(announcer()).toHaveTextContent("Moviendo Gimnasio, posición 3 de 3.");
    expect(grip.closest('[data-slot="accordion-item"]')).toHaveAttribute("data-drag", "lifted");
    keys(grip, "ArrowUp");
    expect(announcer()).toHaveTextContent("Gimnasio, posición 2 de 3.");
    expect(onChange).not.toHaveBeenCalled();
    keys(grip, "Enter");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["Seguro médico", "Gimnasio", "Horario flexible"]);
    expect(announcer()).toHaveTextContent("Gimnasio, posición 2 de 3.");
  });
  it("changes nothing on Escape or a drop in the same place", () => {
    const onChange = list();
    const grip = handle(1); act(() => grip.focus());
    keys(grip, " ", "ArrowDown", "ArrowDown", "Escape");
    expect(announcer()).toHaveTextContent("Movimiento cancelado. Seguro médico se queda en la posición 1 de 3.");
    keys(grip, "Enter", "ArrowDown", "ArrowUp", "Enter");
    expect(announcer()).toHaveTextContent("Seguro médico se queda en la posición 1 de 3.");
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector("[data-drag]")).toBeNull();
  });
});
