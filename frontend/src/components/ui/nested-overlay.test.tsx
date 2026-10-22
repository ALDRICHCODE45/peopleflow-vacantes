import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "./alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Confirmations open from inside an open Sheet are nested Base UI dialogs. Base UI skips a nested
// Backdrop unless `forceRender`, so they showed no dim/blur behind them (design QA, 2026-10-22).
it("renders the blurred overlay for an AlertDialog opened inside a Sheet", async () => {
  render(<Sheet open><SheetContent><SheetTitle>Ficha</SheetTitle><SheetDescription>Detalle</SheetDescription>
    <AlertDialog open><AlertDialogContent><AlertDialogTitle>¿Guardar cambios?</AlertDialogTitle><AlertDialogDescription>Se guardarán.</AlertDialogDescription></AlertDialogContent></AlertDialog>
  </SheetContent></Sheet>);
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]');
  expect(overlay).not.toBeNull();
  expect(overlay).toHaveClass("supports-backdrop-filter:backdrop-blur-sm");
});

it("renders the blurred overlay for a Dialog opened inside a Sheet", async () => {
  render(<Sheet open><SheetContent><SheetTitle>Ficha</SheetTitle><SheetDescription>Detalle</SheetDescription>
    <Dialog open><DialogContent><DialogTitle>Descartar</DialogTitle><DialogDescription>Motivo</DialogDescription></DialogContent></Dialog>
  </SheetContent></Sheet>);
  expect(await screen.findByRole("dialog", { name: "Descartar" })).toBeInTheDocument();
  expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeNull();
});
