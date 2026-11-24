import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { FileField } from "./file-field";

afterEach(cleanup);

const pdf = (name = "Contrato marco.pdf", size = 183_296) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
function Harness({ error = null, disabled, onChange }: { error?: string | null; disabled?: boolean; onChange?: (file: File | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  return <FileField value={file} onChange={next => { setFile(next); onChange?.(next); }} accept=".pdf,.docx" hint="PDF o Word · máximo 10 MB" error={error} disabled={disabled} />;
}

describe("empty", () => {
  it("shows a labelled file input, the hint, and an «Elegir archivo» button that opens it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Archivo");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".pdf,.docx");
    expect(input).toHaveAccessibleDescription("PDF o Word · máximo 10 MB");
    const open = vi.fn(); input.addEventListener("click", open);
    await user.click(screen.getByRole("button", { name: "Elegir archivo" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("uses the short phone copy «Elige un archivo» next to the desktop one", () => {
    render(<Harness />);
    expect(screen.getByText("Elige un archivo")).toHaveClass("sm:hidden");
    expect(screen.getByText("Arrastra un archivo o elígelo")).toHaveClass("hidden", "sm:inline");
  });
});

describe("selected", () => {
  it("replaces the prompt by a card with the name, the format and the size", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText("Archivo"), pdf());
    const card = screen.getByRole("group", { name: "Archivo elegido" });
    expect(within(card).getByText("Contrato marco.pdf")).toBeVisible();
    expect(within(card).getByText("PDF · 179 KB")).toBeVisible();
    expect(within(card).getByText("PDF", { selector: "[data-pf-file-badge]" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Elegir archivo" })).toBeNull();
  });
  it("«Quitar» clears the file and brings back the prompt, so the same file can be chosen again", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const file = pdf();
    await user.upload(screen.getByLabelText("Archivo"), file);
    await user.click(screen.getByRole("button", { name: "Quitar" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("group", { name: "Archivo elegido" })).toBeNull();
    expect((screen.getByLabelText("Archivo") as HTMLInputElement).value).toBe("");
    await user.upload(screen.getByLabelText("Archivo"), file);
    expect(onChange).toHaveBeenLastCalledWith(file);
  });
  it("«Cambiar» re-opens the file input", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText("Archivo"), pdf());
    const open = vi.fn(); screen.getByLabelText("Archivo").addEventListener("click", open);
    await user.click(screen.getByRole("button", { name: "Cambiar" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("rejects nothing itself: a file outside `accept` still reaches the caller", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const zip = new File(["x"], "datos.zip", { type: "application/zip" });
    await user.upload(screen.getByLabelText("Archivo"), zip);
    expect(onChange).toHaveBeenCalledWith(zip);
    expect(screen.getByText("datos.zip")).toBeVisible();
  });
});

describe("drag and drop", () => {
  it("takes the first dropped file and highlights the field while dragging", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const zone = document.querySelector<HTMLElement>("[data-slot=file-field-zone]")!;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"], files: [] } });
    expect(zone).toHaveAttribute("data-drag", "true");
    const file = pdf();
    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(onChange).toHaveBeenCalledWith(file);
    expect(screen.getByText("Contrato marco.pdf")).toBeVisible();
  });
  it("ignores a drop while disabled", () => {
    const onChange = vi.fn();
    render(<Harness disabled onChange={onChange} />);
    fireEvent.drop(document.querySelector("[data-slot=file-field-zone]")!, { dataTransfer: { types: ["Files"], files: [pdf()] } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("states", () => {
  it("shows the caller's error as an alert tied to the input", () => {
    render(<Harness error="No aceptamos archivos .zip." />);
    expect(screen.getByRole("alert")).toHaveTextContent("No aceptamos archivos .zip.");
    const input = screen.getByLabelText("Archivo");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(expect.stringContaining("No aceptamos archivos .zip."));
  });
  it("disables the input and its buttons", async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    expect(screen.getByLabelText("Archivo")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeDisabled();
    await user.upload(screen.getByLabelText("Archivo"), pdf());
    expect(screen.queryByRole("group", { name: "Archivo elegido" })).toBeNull();
  });
});
