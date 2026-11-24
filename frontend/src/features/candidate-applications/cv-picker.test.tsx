import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { CvPicker } from "./cv-picker";
import { cv, library } from "@/features/candidate-cvs/test-fixtures";
import type { CvLibrary } from "@/features/candidate-cvs/model";
import { uploadCv } from "@/features/candidate-cvs/upload";
vi.mock("@/features/candidate-cvs/upload", () => ({ uploadCv: vi.fn() }));
vi.mock("@/features/candidate-cvs/actions", () => ({ loadCvsAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const onBusy = vi.fn(), onWrongRole = vi.fn();
function Picker({ initial = { ...library, items: [] } }: { initial?: CvLibrary }) {
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState("");
  return <CvPicker library={data} selected={selected} onSelect={setSelected} onLibrary={setData} onBusy={onBusy} onWrongRole={onWrongRole} />;
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(uploadCv).mockResolvedValue({ ok: true, data: cv }); });
afterEach(cleanup);
it("explains the empty library and opens the existing upload, selecting the resulting CV", async () => {
  const { container } = render(<Picker />);
  expect(screen.getByRole("heading", { level: 3, name: "Todavía no tienes un CV" })).toBeVisible();
  expect(screen.getByText("Sube tu CV para completar esta postulación. Se agregará a tu biblioteca y quedará seleccionado para esta vacante.")).toBeVisible();
  expect(screen.queryByText("Elige un CV de tu biblioteca. Es obligatorio.")).toBeNull();
  expect(container.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-muted");
  expect(container.querySelector('[data-slot="empty-icon"] svg')).toHaveClass("lucide-file-text");
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const click = vi.spyOn(input, "click");
  await userEvent.setup().click(screen.getByRole("button", { name: "Subir CV" }));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/PDF o Word \(\.docx\), hasta 5 MB\. 0 de 10 CVs/)).toBeVisible();
  const file = new File(["pdf"], "cv.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(uploadCv).toHaveBeenCalledWith(file, library.limits));
  expect(await screen.findByRole("button", { name: cv.name })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("heading", { name: "Todavía no tienes un CV" })).toBeNull();
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
  expect(onWrongRole).not.toHaveBeenCalled();
});
it("preserves choosing an existing CV and the existing upload control", async () => {
  render(<Picker initial={library} />);
  expect(screen.getByText("Elige un CV de tu biblioteca. Es obligatorio.")).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: cv.name }));
  expect(screen.getByRole("button", { name: cv.name })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Subir un CV nuevo")).toBeEnabled();
  expect(uploadCv).not.toHaveBeenCalled();
});
it("shows the styled file field (no visible native input) when the library has CVs", async () => {
  const { container } = render(<Picker initial={library} />);
  const input = screen.getByLabelText("Subir un CV nuevo");
  expect(input).toHaveAttribute("type", "file");
  expect(input).toHaveClass("sr-only");
  expect(input).toHaveAttribute("accept", expect.stringContaining(".docx"));
  expect(input).toHaveAccessibleDescription(expect.stringMatching(/PDF o Word \(\.docx\), hasta 5 MB\. 1 de 10 CVs/));
  expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeEnabled();
  expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
});
it("uploads the chosen file once, clears the card and selects the new CV", async () => {
  const user = userEvent.setup();
  vi.mocked(uploadCv).mockResolvedValue({ ok: true, data: { ...cv, id: "cv-new", name: "Nuevo.pdf" } });
  render(<Picker initial={library} />);
  const file = new File(["pdf"], "Nuevo.pdf", { type: "application/pdf" });
  await user.upload(screen.getByLabelText("Subir un CV nuevo"), file);
  await waitFor(() => expect(uploadCv).toHaveBeenCalledWith(file, library.limits));
  expect(await screen.findByRole("button", { name: "Nuevo.pdf" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("group", { name: "Archivo elegido" })).toBeNull();
  expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeVisible();
});
it("rejects an invalid file before uploading, keeps it visible with the error and focuses the field button", async () => {
  const user = userEvent.setup();
  render(<Picker initial={library} />);
  // fireEvent: user.upload would move focus back to the input after the change, which a real file dialog does not.
  fireEvent.change(screen.getByLabelText("Subir un CV nuevo"), { target: { files: [new File(["x"], "bad.exe", { type: "text/plain" })] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Sube un PDF o un documento de Word (.docx).");
  expect(uploadCv).not.toHaveBeenCalled();
  expect(screen.getByRole("group", { name: "Archivo elegido" })).toHaveTextContent("bad.exe");
  expect(screen.getByLabelText("Subir un CV nuevo")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Cambiar" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Quitar" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeVisible();
});
