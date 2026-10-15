import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("./actions", () => ({ listDraftsAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { listDraftsAction } from "./actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { DraftList } from "./draft-list";
const id = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const row = { id, title: "Analista", requester: { kind: "client" as const, id, name: "Acme" }, principal_recruiter: { id, name: "Ana" }, version: "1", created_at: "2026-10-15T12:00:00Z", updated_at: "2026-10-15T12:00:00Z" };
beforeEach(() => vi.resetAllMocks()); afterEach(cleanup);
it("shows loading structure and reserves the result line", () => {
 vi.mocked(listDraftsAction).mockReturnValue(new Promise(() => {})); const { container } = render(<DraftList />);
 expect(screen.getByText("Cargando borradores…")).toBeInTheDocument(); expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
 expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull(); expect(container.querySelector('[data-pf-action-status-slot]')).not.toBeNull();
});
it("renders S2 rows, labels, es-MX date and reopen links", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [row, { ...row, id: "a", title: null, requester: { kind: "internal_area", id: null, name: null }, principal_recruiter: { id, name: null } }, { ...row, id: "b", title: "Otro", requester: null }], nextCursor: null });
 render(<DraftList />); expect(await screen.findByRole("link", { name: "Abrir Analista" })).toHaveAttribute("href", `/empresa/vacantes/borradores/${id}`);
 for (const text of ["Sin título", "Acme", "Área interna", "Usuario dado de baja"]) expect(screen.getByText(text)).toBeInTheDocument();
 expect(screen.getAllByText(new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.updated_at)))).toHaveLength(3);
 expect(notifyActionResult).not.toHaveBeenCalled();
});
it("appends more, deduplicates moving drafts and refreshes without cursor", async () => {
 vi.mocked(listDraftsAction)
 .mockResolvedValueOnce({ ok: true, items: [row], nextCursor: "opaque+/=" })
 .mockResolvedValueOnce({ ok: true, items: [{ ...row, title: "Actualizado" }, { ...row, id: "second", title: "Segundo" }], nextCursor: null })
 .mockResolvedValueOnce({ ok: true, items: [{ ...row, title: "Refrescado" }], nextCursor: null });
 render(<DraftList />); await screen.findByText("Analista"); fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
 await screen.findByText("Segundo"); expect(screen.getAllByRole("link", { name: /Abrir / })).toHaveLength(2);
 expect(listDraftsAction).toHaveBeenNthCalledWith(2, { limit: 20, cursor: "opaque+/=" });
 fireEvent.click(screen.getByRole("button", { name: "Actualizar" })); await screen.findByText("Refrescado"); expect(screen.queryByText("Segundo")).not.toBeInTheDocument();
 expect(listDraftsAction).toHaveBeenNthCalledWith(3, { limit: 20 });
});
it("shows empty only after success with create link", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [], nextCursor: null }); render(<DraftList />);
 expect(await screen.findByText("Aún no tienes borradores")).toBeInTheDocument(); expect(screen.getByRole("link", { name: "Nuevo borrador" })).toHaveAttribute("href", "/empresa/vacantes/borradores/nuevo");
});
it("keeps rows on failure and reports it in toast and reserved line", async () => {
 vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: true, items: [row], nextCursor: "next" }).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500, code: "internal_error" } });
 const { container } = render(<DraftList />); await screen.findByText("Analista"); fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
 await screen.findByText("No se cargaron los borradores · ver aviso"); expect(screen.getByText("Analista")).toBeInTheDocument();
 expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "draft-list", type: "error", reference: expect.objectContaining({ status: 500, code: "internal_error", at: expect.any(String) }) }));
 expect(container.querySelector('[data-pf-action-status-slot]')).toHaveTextContent("No se cargaron");
 expect(screen.getByRole("button", { name: "Cargar más" })).toHaveAttribute("aria-describedby");
});
it("handles an initial failure without claiming empty and supports explicit refresh", async () => {
 vi.mocked(listDraftsAction).mockRejectedValueOnce(new Error("unsafe")).mockResolvedValueOnce({ ok: true, items: [], nextCursor: null }); render(<DraftList />);
 await screen.findByText("No se cargaron los borradores · ver aviso"); expect(screen.queryByText("Aún no tienes borradores")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Actualizar" })); await waitFor(() => expect(screen.getByText("Aún no tienes borradores")).toBeInTheDocument());
});
it("toasts a confirmed refresh but not each extra page", async () => {
 vi.mocked(listDraftsAction)
 .mockResolvedValueOnce({ ok: true, items: [row], nextCursor: "next" })
 .mockResolvedValueOnce({ ok: true, items: [{ ...row, id: "second", title: "Segundo" }], nextCursor: null })
 .mockResolvedValueOnce({ ok: true, items: [row], nextCursor: null });
 render(<DraftList />); await screen.findByText("Analista"); fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
 await screen.findByText("Segundo"); expect(notifyActionResult).not.toHaveBeenCalled();
 expect(screen.getByText("Borradores cargados")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
 await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "draft-list", type: "success", title: "Lista actualizada" })));
 expect(screen.getByText("Lista actualizada")).toBeInTheDocument();
});
it("shows a page-level Empty with Actualizar when the first load fails", async () => {
 vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500 } });
 render(<DraftList />);
 expect(await screen.findByText("No pudimos cargar tus borradores")).toBeInTheDocument();
 expect(screen.queryByRole("list", { name: "Borradores guardados" })).not.toBeInTheDocument();
 expect(screen.queryByText("Aún no tienes borradores")).not.toBeInTheDocument();
});
