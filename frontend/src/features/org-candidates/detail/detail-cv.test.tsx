import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrgCandidateDetailSheet } from "./detail-sheet";
import { loadOrgCandidateDetailAction } from "./detail-actions";
import { detailFixture, id } from "./test-fixtures";
import { orgCandidateDetailSchema } from "./detail-model";
import { loadOrgCandidateHistoryAction } from "../history/history-actions";
vi.mock("../edit/edit-actions", () => ({ saveOrgCandidateEditAction: vi.fn() }));
vi.mock("../history/history-actions", () => ({ loadOrgCandidateHistoryAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("./detail-actions", () => ({ loadOrgCandidateDetailAction: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ data: { items: [] } }) }));
const fetch = vi.fn();
const identity = { kind: "manual" as const, id: id(1) };
const corrected = (kind: "manual" | "organic" = "manual") => {
 const data = detailFixture(kind);
 return { ...data, etag: '"v2"', participations: [{ ...data.participations[0], cv: { ...data.participations[0].cv!, source: "company", file_name: "corregido.pdf" }, original_cv: data.participations[0].cv }] };
};
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetch); vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: detailFixture() }); vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = () => render(<OrgCandidateDetailSheet candidate={identity} onOpenChange={vi.fn()} />);
async function showProcesses() {
 fireEvent.click(await screen.findByRole("tab", { name: /^Procesos/ }));
 return screen.getByRole("region", { name: "Procesos" });
}
async function pick(file = new File(["%PDF-test"], "corregido.pdf", { type: "application/pdf" })) {
 await showProcesses();
 const input = screen.getByLabelText("CV corregido para Frontend");
 fireEvent.change(input, { target: { files: [file] } });
 return input;
}
it("accepts additive source/original metadata while retaining legacy fixtures", () => {
 expect(orgCandidateDetailSchema.safeParse(detailFixture()).success).toBe(true);
 expect(orgCandidateDetailSchema.safeParse(corrected()).success).toBe(true);
 const data = corrected(); data.participations[0].cv.source = "unknown";
 expect(orgCandidateDetailSchema.safeParse(data).success).toBe(false);
});
it.each(["manual", "organic"] as const)("composes the %s process with a document footer and separate upload/status", async kind => {
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: orgCandidateDetailSchema.parse(corrected(kind)) });
 render(<OrgCandidateDetailSheet candidate={{ ...identity, kind }} onOpenChange={vi.fn()} />);
 const processes = await showProcesses();
 const actions = [
  within(processes).getByRole("link", { name: "Descargar CV de Frontend" }),
  within(processes).getByRole("link", { name: "Descargar CV original de Frontend" }),
  within(processes).getByRole("button", { name: "Subir CV corregido" }),
 ];
 const process = actions[2].closest('[role="listitem"]')!;
 expect(process).not.toBeNull();
 expect(process.querySelector('[data-slot="card"]')).toBeNull();
 expect(process).toContainElement(within(processes).getByRole("link", { name: "Frontend" }));
 expect(process).toHaveTextContent(/Entrevista · Esperando respuesta/);
 expect(process).toHaveTextContent(/Ingreso manual .* · Agregado por Tomás Ríos/);
 expect(process).toContainElement(within(processes).getByText("Activa"));
 const document = actions[0].closest<HTMLElement>('[data-slot="item"]')!;
 expect(process).toContainElement(document);
 expect(document).toHaveAttribute("data-variant", "muted");
 expect(document.querySelector('[data-slot="item-media"]')).toHaveAttribute("data-variant", "icon");
 expect(document.querySelector('[data-slot="item-title"]')).toHaveTextContent("corregido.pdf");
 const description = document.querySelector('[data-slot="item-description"]')!;
 expect(description).toHaveTextContent(/^Documento PDF/);
 expect(within(description as HTMLElement).getByText("CV corregido por tu empresa")).toHaveAttribute("data-slot", "badge");
 const downloads = document.querySelector('[data-slot="item-footer"]')!;
 expect(Array.from(downloads.querySelectorAll("a"))).toEqual(actions.slice(0, 2));
 expect(downloads).toHaveClass("flex-wrap");
 expect(document.querySelector('[data-slot="item-actions"]')).toContainElement(within(processes).getByRole("link", { name: "Descargar archivo CV de Frontend" }));
 expect(within(processes).getAllByRole("button", { name: "Subir CV corregido" })).toEqual([actions[2]]);
 expect(actions[2]).toHaveClass("self-start");
 expect(process).toContainElement(actions[2]);
 expect(document).not.toContainElement(actions[2]);
 expect(within(processes).getByText("PDF o DOCX · Máximo 5 MB")).toBeVisible();
 for (const action of actions) {
  expect(action).not.toHaveClass("w-full");
  expect(action).toHaveClass("min-h-10");
  expect(action.querySelector('svg[data-icon]')).not.toBeNull();
 }
 expect(process.querySelector("[data-pf-action-status-slot]")).toBeInTheDocument();
 const badge = within(processes).getByText("CV corregido por tu empresa");
 expect(badge).toHaveClass("bg-primary/12");
 expect(document.querySelector('[data-slot="item-description"]')).toContainElement(badge);
});
it.each([undefined, "candidate"] as const)("shows only the current download for uncorrected CV source %s", async source => {
 const data = detailFixture(); data.participations[0].cv!.source = source;
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); open(); const processes = await showProcesses();
 expect(within(processes).getByRole("link", { name: "Descargar CV de Frontend" })).toHaveAttribute("href", `/api/company/candidates/manual/${id(1)}/participations/${id(2)}/cv`);
 expect(screen.queryByText("Descargar CV original")).not.toBeInTheDocument();
 expect(screen.queryByText("CV corregido por tu empresa")).not.toBeInTheDocument();
 const upload = screen.getByRole("button", { name: "Subir CV corregido" });
 expect(upload).toBeEnabled();
 expect(within(processes).getAllByRole("button", { name: "Subir CV corregido" })).toEqual([upload]);
 expect(upload.closest('[role="listitem"]')).not.toBeNull();
 expect(within(processes).getByRole("link", { name: "Descargar CV de Frontend" }).closest('[data-slot="item-footer"]')).not.toBeNull();
});
it("does not offer an original download when the corrected CV has no original", async () => {
 const data = orgCandidateDetailSchema.parse(corrected()); data.participations[0].original_cv = null;
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); open();
 await showProcesses(); await screen.findByText("CV corregido por tu empresa");
 expect(screen.queryByRole("link", { name: "Descargar CV original de Frontend" })).not.toBeInTheDocument();
 expect(screen.getByRole("link", { name: "Descargar CV de Frontend" })).toHaveAttribute("download");
});
it("keeps a single upload action and its reserved status slot when there is no CV", async () => {
 const data = detailFixture(); data.participations[0].cv = null;
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); open();
 const processes = await showProcesses();
 const empty = within(processes).getByText("Sin CV en este proceso");
 expect(empty).toBeVisible();
 expect(empty).toHaveClass("text-muted-foreground");
 expect(empty.closest('[data-slot="item"]')).toHaveAttribute("data-variant", "muted");
 expect(within(processes).getByRole("button", { name: "Subir CV corregido" }).closest('[role="listitem"]')).not.toBeNull();
 expect(within(processes).queryByRole("link", { name: /Descargar CV/ })).not.toBeInTheDocument();
 expect(within(processes).getAllByRole("button", { name: "Subir CV corregido" })).toHaveLength(1);
 expect(processes.querySelector("[data-pf-action-status-slot]")).toBeInTheDocument();
});
it("shows the company badge and both real downloads", async () => {
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: orgCandidateDetailSchema.parse(corrected()) }); open(); await showProcesses();
 expect(await screen.findByText("CV corregido por tu empresa")).toHaveAttribute("data-slot", "badge");
 expect(screen.getByRole("link", { name: "Descargar CV original de Frontend" })).toHaveAttribute("href", `/api/company/candidates/manual/${id(1)}/participations/${id(2)}/cv/original`);
 // v0 uses quiet downloads inside the single document footer, not outlined controls.
 for (const name of ["Descargar CV de Frontend", "Descargar CV original de Frontend"]) expect(screen.getByRole("link", { name }).closest('[data-slot="item-footer"]')).not.toBeNull();
 expect(screen.getByRole("link", { name: "Descargar CV de Frontend" })).toHaveAttribute("download");
});
it.each(["manual", "organic"] as const)("confirms the %s file before transport and refreshes detail/history on success", async kind => {
 const data = detailFixture(kind); vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data });
 const updated = { ...data, etag: '"v2"' }; fetch.mockResolvedValue(Response.json(updated));
 const onUpdated = vi.fn(); render(<OrgCandidateDetailSheet candidate={{ ...identity, kind }} onOpenChange={vi.fn()} onCandidateUpdated={onUpdated} />);
 await pick(); const dialog = await screen.findByRole("alertdialog");
 expect(within(dialog).getByRole("heading")).toHaveTextContent("¿Subir CV corregido de Lucía Ramírez Torres?");
 expect(within(dialog).getByText(kind === "organic" ? "El candidato conserva su CV original; tu empresa verá el corregido." : "Reemplaza el CV de este proceso; el CV de ingreso se conserva como original.")).toBeVisible();
 expect(dialog.querySelector('[data-slot="alert-dialog-media"] svg')).not.toBeNull();
 expect(dialog.querySelector('[data-slot="confirm-action-details"]')).toHaveTextContent("corregido.pdf");
 expect(dialog.querySelector('[data-slot="confirm-action-details"]')).toHaveTextContent("9 B");
 expect(fetch).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole("button", { name: "Subir CV corregido" }));
 await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
 await waitFor(() => expect(loadOrgCandidateHistoryAction).toHaveBeenCalledTimes(2));
 expect(fetch.mock.calls[0][1].headers).toEqual({ "If-Match": '"v1"' });
 const { notifyActionResult } = await import("@/components/feedback/notify");
 expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "CV corregido guardado" }));
});
it("opens the file picker before confirmation and lets the user choose a different file", async () => {
 open(); await showProcesses();
 const input = screen.getByLabelText("CV corregido para Frontend"); const click = vi.spyOn(input, "click");
 fireEvent.click(screen.getByRole("button", { name: "Subir CV corregido" }));
 expect(click).toHaveBeenCalledTimes(1); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
 await pick(); fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Elegir otro archivo" }));
 expect(click).toHaveBeenCalledTimes(2);
 fireEvent.change(input, { target: { files: [new File(["PDF"], "otro.pdf", { type: "application/pdf" })] } });
 expect(screen.getByRole("alertdialog")).toHaveTextContent("otro.pdf");
});
it("canceling the dialog never uploads", async () => {
 open(); await pick(); fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
 await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()); expect(fetch).not.toHaveBeenCalled();
});
it("retains the file on 412, refreshes without unmounting and retries with the fresh etag", async () => {
 open(); await pick();
 fetch.mockResolvedValueOnce(Response.json({ error: "private", code: "precondition_failed" }, { status: 412 })).mockResolvedValueOnce(Response.json({ ...detailFixture(), etag: '"v3"' }));
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: { ...detailFixture(), etag: '"v2"' } });
 fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Subir CV corregido" }));
 await waitFor(() => expect(loadOrgCandidateDetailAction).toHaveBeenCalledTimes(2));
 expect(await screen.findByRole("status", { name: "" })).toHaveTextContent("Esto cambió en otro lugar");
 fireEvent.click(screen.getByRole("button", { name: "Subir CV corregido" }));
 expect(await screen.findByRole("alertdialog")).toHaveTextContent("corregido.pdf");
 fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Subir CV corregido" }));
 await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(fetch.mock.calls[1][1].headers).toEqual({ "If-Match": '"v2"' });
});
it("blocks duplicate confirmation and editing while the upload is pending", async () => {
 let resolve!: (value: Response) => void; fetch.mockReturnValue(new Promise(yes => { resolve = yes; }));
 open(); await pick(); const dialog = await screen.findByRole("alertdialog");
 expect(dialog.querySelector('[data-slot="alert-dialog-header"] [data-slot="alert-dialog-media"]')).not.toBeNull();
 expect(document.querySelector('[data-slot="alert-dialog-overlay"]')).not.toBeNull();
 const confirm = within(dialog).getByRole("button", { name: "Subir CV corregido" });
 fireEvent.click(confirm); fireEvent.click(confirm);
 expect(fetch).toHaveBeenCalledTimes(1);
 expect(within(dialog).getByRole("button", { name: "Subiendo…" })).toBeDisabled();
 expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
 await act(async () => resolve(Response.json({ ...detailFixture(), etag: '\"v2\"' })));
 await waitFor(() => expect(screen.getByRole("button", { name: "Editar datos" })).toBeEnabled());
});
it("keeps the picked file and only retries the read if conflict refresh fails", async () => {
 open(); await pick(); fetch.mockResolvedValue(Response.json({ code: "precondition_failed" }, { status: 412 }));
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockResolvedValueOnce({ ok: true, data: { ...detailFixture(), etag: '\"v2\"' } });
 fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Subir CV corregido" }));
 const refresh = await screen.findByRole("button", { name: "Actualizar ficha" });
 await waitFor(() => expect(refresh).toBeEnabled()); fireEvent.click(refresh);
 await waitFor(() => expect(screen.getByRole("button", { name: "Subir CV corregido" })).toBeEnabled());
 expect(fetch).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("button", { name: "Subir CV corregido" }));
 expect(await screen.findByRole("alertdialog")).toHaveTextContent("corregido.pdf");
});
it("reconciles an uncertain response before offering another upload", async () => {
 open(); await pick(); fetch.mockRejectedValue(new Error("private network error"));
 vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: { ...detailFixture(), etag: '\"v2\"' } });
 fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Subir CV corregido" }));
 await waitFor(() => expect(loadOrgCandidateDetailAction).toHaveBeenCalledTimes(2));
 expect(fetch).toHaveBeenCalledTimes(1);
 expect(screen.getByRole("status")).toHaveTextContent("No pudimos confirmar el guardado");
});
it("shows file and server validation in the card's reserved ActionStatus", async () => {
 open(); const input = await pick(new File(["doc"], "cv.doc", { type: "application/msword" }));
 expect(screen.getByRole("status")).toHaveTextContent("Sube un PDF o un documento de Word (.docx).");
 expect(screen.getByRole("status").closest("[data-pf-action-status-slot]")).not.toBeNull();
 expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
 fireEvent.change(input, { target: { files: [new File(["%PDF"], "good.pdf", { type: "application/pdf" })] } });
 fetch.mockResolvedValue(Response.json({ code: "validation_error", error: "private" }, { status: 400 }));
 fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Subir CV corregido" }));
 await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Revisa el archivo e intenta de nuevo."));
 expect(screen.queryByText("private")).not.toBeInTheDocument();
});
