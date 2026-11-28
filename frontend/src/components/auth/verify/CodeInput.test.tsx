import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODE_LENGTH, CodeInput, emptyCode } from "./CodeInput";

function Harness({ onFilled = () => {} }: { onFilled?: () => void }) {
  const [digits, setDigits] = React.useState(emptyCode());
  return (
    <>
      <CodeInput digits={digits} onDigitsChange={setDigits} onFilled={onFilled} hint="Pista" />
      <output data-testid="code">{digits.join("")}</output>
      <button type="button">Verificar</button>
    </>
  );
}

const cell = (n: number) => screen.getByRole("textbox", { name: `Dígito ${n} de 6` });
const code = () => screen.getByTestId("code").textContent;
const paste = (target: HTMLElement, text: string) =>
  fireEvent.paste(target, { clipboardData: { getData: (type: string) => (type === "text" || type === "text/plain" ? text : "") } });

afterEach(cleanup);

describe("six-box code input (artboard «Verifica tu correo»)", () => {
  it("is a fieldset «Código de verificación» with six numeric boxes, the first one offering the one-time code", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Código de verificación" })).toBeInTheDocument();
    expect(CODE_LENGTH).toBe(6);
    for (let n = 1; n <= 6; n += 1) {
      const input = cell(n);
      expect(input).toHaveAttribute("inputmode", "numeric");
      expect(input).toHaveAttribute("autocomplete", n === 1 ? "one-time-code" : "off");
    }
  });

  it("advances the focus as digits are typed and ignores anything else", () => {
    render(<Harness />);
    cell(1).focus();
    fireEvent.change(cell(1), { target: { value: "1" } });
    expect(cell(2)).toHaveFocus();
    fireEvent.change(cell(2), { target: { value: "a" } });
    expect(cell(2)).toHaveFocus();
    expect(code()).toBe("1");
    fireEvent.change(cell(2), { target: { value: "2" } });
    expect(cell(3)).toHaveFocus();
    expect(code()).toBe("12");
  });

  it("replaces a filled box with the new digit", () => {
    render(<Harness />);
    fireEvent.change(cell(1), { target: { value: "1" } });
    fireEvent.change(cell(1), { target: { value: "17" } });
    expect(code()).toBe("7");
    fireEvent.change(cell(1), { target: { value: "37" } });
    expect(code()).toBe("3");
  });

  it("Backspace clears the box, and on an empty box goes back and clears the previous one", () => {
    render(<Harness />);
    fireEvent.change(cell(1), { target: { value: "1" } });
    fireEvent.change(cell(2), { target: { value: "2" } });
    expect(cell(3)).toHaveFocus();
    fireEvent.keyDown(cell(3), { key: "Backspace" });
    expect(cell(2)).toHaveFocus();
    expect(code()).toBe("1");
    fireEvent.keyDown(cell(2), { key: "Backspace" });
    expect(cell(1)).toHaveFocus();
    expect(code()).toBe("");
    fireEvent.change(cell(1), { target: { value: "9" } });
    cell(1).focus();
    fireEvent.keyDown(cell(1), { key: "Backspace" });
    expect(cell(1)).toHaveFocus();
    expect(code()).toBe("");
  });

  it("moves with the arrow keys", () => {
    render(<Harness />);
    cell(3).focus();
    fireEvent.keyDown(cell(3), { key: "ArrowLeft" });
    expect(cell(2)).toHaveFocus();
    fireEvent.keyDown(cell(2), { key: "ArrowRight" });
    expect(cell(3)).toHaveFocus();
  });

  it("pasting the whole code into any box fills all six and reports it filled (no auto-submit)", () => {
    const onFilled = vi.fn();
    render(<Harness onFilled={onFilled} />);
    paste(cell(4), "482913");
    expect(code()).toBe("482913");
    expect(onFilled).toHaveBeenCalledTimes(1);
  });

  it("strips spaces and dashes from a pasted code, and fills a partial paste from the box onward", () => {
    render(<Harness />);
    paste(cell(1), " 482-913 ");
    expect(code()).toBe("482913");
    cleanup();
    render(<Harness />);
    paste(cell(2), "48");
    expect(cell(1)).toHaveValue("");
    expect(cell(2)).toHaveValue("4");
    expect(cell(3)).toHaveValue("8");
    expect(cell(4)).toHaveFocus();
  });

  it("accepts a whole code autofilled into the first box", () => {
    const onFilled = vi.fn();
    render(<Harness onFilled={onFilled} />);
    fireEvent.change(cell(1), { target: { value: "482913" } });
    expect(code()).toBe("482913");
    expect(onFilled).toHaveBeenCalledTimes(1);
  });

  it("reports filled when the last box completes the code by typing", () => {
    const onFilled = vi.fn();
    render(<Harness onFilled={onFilled} />);
    "48291".split("").forEach((digit, index) => fireEvent.change(cell(index + 1), { target: { value: digit } }));
    expect(onFilled).not.toHaveBeenCalled();
    fireEvent.change(cell(6), { target: { value: "3" } });
    expect(onFilled).toHaveBeenCalledTimes(1);
  });
});
