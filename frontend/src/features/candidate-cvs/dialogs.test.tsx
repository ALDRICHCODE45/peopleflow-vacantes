import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("./actions", () => ({ renameCvAction: vi.fn(), deleteCvAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { renameCvAction, deleteCvAction } from "./actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { CvDialog } from "./cv-dialog";
import { cv } from "./test-fixtures";
import { cvRowActions, normalizeCvName, validCvName } from "./model";
const onClose = vi.fn(), onSaved = vi.fn(), onCheck = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); onCheck.mockResolvedValue(true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(renameCvAction).mockResolvedValue({ ok: true, data: { ...cv, name: "Nuevo" } });
  vi.mocked(deleteCvAction).mockResolvedValue({ ok: true, data: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function show(mode: "rename" | "delete") { return render(<CvDialog cv={cv} mode={mode} onClose={onClose} onSaved={onSaved} onCheck={onCheck} />); }
describe("CV peer actions and names", () => {
  it("returns exactly download, rename and delete with a same-origin download URL", () => {
    expect(cvRowActions(cv)).toEqual([{ key: "download", label: "Descargar", href: `/api/candidate/cvs/${cv.id}/file` }, { key: "rename", label: "Renombrar" }, { key: "delete", label: "Eliminar" }]);
  });
  it("counts normalized Unicode code points rather than UTF-16 units", () => {
    expect(normalizeCvName(" \u00a0A\u0301   CV\n")).toBe("Á CV");
    expect(validCvName("😀".repeat(120))).toBe(true); expect(validCvName("😀".repeat(121))).toBe(false);
  });
});
describe("CV dialogs", () => {
  it.each(["rename", "delete"] as const)("keeps %s edits and storage copy in toast and ActionStatus without retry", async mode => {
    const failure = { ok: false, reason: "storage_unavailable", reference: { status: 503, code: "cv_storage_unavailable" } } as const;
    vi.mocked(renameCvAction).mockResolvedValue(failure); vi.mocked(deleteCvAction).mockResolvedValue(failure);
    show(mode);
    if (mode === "rename") fireEvent.change(await screen.findByLabelText("Nombre del CV"), { target: { value: "Mi edición" } });
    fireEvent.click(await screen.findByRole("button", { name: mode === "rename" ? "Guardar nombre" : "Eliminar CV" }));
    const title = "Los CVs no están disponibles en este momento", description = "Puedes intentarlo más tarde; lo que ya escribiste se conserva.";
    expect(await screen.findByRole("status")).toHaveTextContent(title);
    expect(screen.getByRole("status")).toHaveTextContent(description);
    expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title, description }));
    if (mode === "rename") expect(screen.getByLabelText("Nombre del CV")).toHaveValue("Mi edición");
    expect(mode === "rename" ? renameCvAction : deleteCvAction).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); expect(onCheck).not.toHaveBeenCalled();
  });
  it.each(["rename", "delete"] as const)("shows the existing company-account state after %s wrong_role", async mode => {
    const failure = { ok: false, reason: "wrong_role", reference: { status: 403, code: "wrong_role" } } as const;
    vi.mocked(renameCvAction).mockResolvedValue(failure); vi.mocked(deleteCvAction).mockResolvedValue(failure);
    show(mode); fireEvent.click(await screen.findByRole("button", { name: mode === "rename" ? "Guardar nombre" : "Eliminar CV" }));
    expect(await screen.findByRole("heading", { name: "Esta cuenta es de empresa" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Ir a empresa" })).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
  it("focuses invalid rename and does not call the action", async () => {
    show("rename"); fireEvent.change(await screen.findByLabelText("Nombre del CV"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(await screen.findByText("Escribe un nombre de 1 a 120 caracteres.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del CV")).toHaveFocus(); expect(renameCvAction).not.toHaveBeenCalled();
  });
  it("renames only on explicit submit and reports confirmation", async () => {
    show("rename"); fireEvent.change(await screen.findByLabelText("Nombre del CV"), { target: { value: " Nuevo " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    await waitFor(() => expect(renameCvAction).toHaveBeenCalledWith(cv.id, { name: "Nuevo" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...cv, name: "Nuevo" }));
    expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Nombre actualizado" }));
  });
  it.each(["rename", "delete"] as const)("reorganizes %s context and actions on mobile without narrowing controls", async mode => {
    show(mode);
    const dialog = await screen.findByRole(mode === "rename" ? "dialog" : "alertdialog");
    expect(dialog.querySelector('[data-pf-cv-dialog-document]')).toHaveClass("flex-wrap");
    const footer = dialog.querySelector(`[data-slot="${mode === "rename" ? "dialog" : "alert-dialog"}-footer"]`);
    expect(footer).not.toBeNull();
    for (const button of footer!.querySelectorAll('button')) expect(button).toHaveClass("min-h-10");
  });
  it("confirms deletion with the exact copy and an in-use note, never on opening", async () => {
    show("delete"); const dialog = await screen.findByRole("alertdialog", { name: `¿Eliminar ${cv.name}?` });
    expect(dialog).toHaveAccessibleDescription("Tus postulaciones conservan su copia. No se puede deshacer.");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Eliminar CV" }).className).toContain("destructive");
    expect(screen.getByText("En uso")).toHaveAttribute("data-variant", "neutral");
    expect(deleteCvAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar CV" }));
    await waitFor(() => expect(deleteCvAction).toHaveBeenCalledWith(cv.id));
    expect(onSaved).toHaveBeenCalledWith(null); expect(onClose).toHaveBeenCalled();
  });
  it("canceling deletion writes nothing and leaves the library untouched", async () => {
    show("delete"); fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledOnce(); expect(onSaved).not.toHaveBeenCalled(); expect(deleteCvAction).not.toHaveBeenCalled();
  });
  it("locks deletion against double confirmation while showing progress", async () => {
    vi.mocked(deleteCvAction).mockReturnValue(new Promise(() => {}));
    show("delete"); const confirm = await screen.findByRole("button", { name: "Eliminar CV" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(deleteCvAction).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Eliminando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });
  it("retains edited data and shows both notification and ActionStatus on rejection", async () => {
    vi.mocked(renameCvAction).mockResolvedValue({ ok: false, reason: "invalid_request", reference: { status: 400, code: "invalid_request" } });
    show("rename"); fireEvent.change(await screen.findByLabelText("Nombre del CV"), { target: { value: "Nuevo" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Revisa los datos marcados");
    expect(screen.getByLabelText("Nombre del CV")).toHaveValue("Nuevo"); expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nombre del CV")).toHaveFocus();
    expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: expect.objectContaining({ status: 400 }) }));
  });
  it("offers read-only Comprobar for an uncertain deletion, never automatic retry", async () => {
    vi.mocked(deleteCvAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
    show("delete"); fireEvent.click(await screen.findByRole("button", { name: "Eliminar CV" }));
    fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
    await waitFor(() => expect(onCheck).toHaveBeenCalledTimes(1)); expect(deleteCvAction).toHaveBeenCalledTimes(1);
  });
});
