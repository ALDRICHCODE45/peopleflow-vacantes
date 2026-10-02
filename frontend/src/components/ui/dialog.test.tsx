import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Example({ close = true, footer = false }: { close?: boolean; footer?: boolean }) {
  return <Dialog open><DialogContent showCloseButton={close}>
    <DialogHeader><DialogTitle>Confirmar cambio de etapa</DialogTitle><DialogDescription>Revisa el movimiento antes de confirmar.</DialogDescription></DialogHeader>
    <DialogFooter showCloseButton={footer} />
  </DialogContent></Dialog>;
}

describe("shared confirmation dialog", () => {
  it("uses a named modal with a Spanish close control and a 40px hit area", () => {
    render(<Example />);
    expect(screen.getByRole("dialog", { name: "Confirmar cambio de etapa" })).toHaveAccessibleDescription("Revisa el movimiento antes de confirmar.");
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveClass("size-10");
  });
  it("allows a product form to own its dismissal actions", () => {
    render(<Example close={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("localizes the optional footer close action", () => {
    render(<Example close={false} footer />);
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveClass("min-h-10");
  });
});
