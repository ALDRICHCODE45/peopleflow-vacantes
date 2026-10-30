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
