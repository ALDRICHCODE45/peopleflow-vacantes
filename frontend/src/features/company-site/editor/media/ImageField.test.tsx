import "@testing-library/jest-dom/vitest";
import { useEffect, useReducer } from "react";
import { SectionForm } from "../forms/section-form";
import { defaultBlock, defaultSiteDraft } from "../../defaults";
import { createEditorState, editorReducer } from "../../editor-state";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageField } from "./index";
import { uploadMedia } from "../../upload";
import { cropImage } from "./crop-image";
import type { ImageFieldProps } from "./contract";

// Keep both collection items mounted while editing another item's text.
vi.mock("@/components/ui/accordion", async original => {
  const parts = await original<typeof import("@/components/ui/accordion")>();
  return { ...parts, Accordion: (props: React.ComponentProps<typeof parts.Accordion>) => <parts.Accordion {...props} multiple /> };
});
vi.mock("../../upload", () => ({ uploadMedia: vi.fn() }));
vi.mock("./crop-image", () => ({ cropImage: vi.fn() }));
vi.mock("react-easy-crop", () => ({ default: function Cropper({ aspect, keyboardStep, onCropComplete }: { aspect: number; keyboardStep: number; onCropComplete: (area: unknown, pixels: unknown) => void }) {
  useEffect(() => { onCropComplete({}, { x: 0, y: 0, width: 800, height: 600 }); }, [onCropComplete]);
  return <div role="img" aria-label={`Recorte ${aspect}`} data-keyboard-step={keyboardStep} />;
} }));

const uploaded = { id: "new-id", kind: "cover" as const, url: "/media/new", width: 800, height: 450, content_type: "image/png" as const };
let dimensions = { width: 1600, height: 1200 };
let imageFails = false;
const revoke = vi.fn();
const create = vi.fn();
function mount(props: Partial<ImageFieldProps> = {}) {
  const onChange = vi.fn();
  const result = render(<ImageField kind="cover" label="Imagen de portada" value={null} onChange={onChange} {...props} />);
  return { ...result, onChange };
}
function choose(file = new File(["image"], "photo.png", { type: "image/png" })) {
  fireEvent.change(screen.getByLabelText("Archivo de Imagen de portada"), { target: { files: [file] } });
}
async function open() {
  choose();
  await screen.findByRole("dialog", { name: "Recortar imagen" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Usar imagen" })).toBeEnabled());
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 300, height: 40, x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 40, toJSON() {} });
  dimensions = { width: 1600, height: 1200 };
  imageFails = false;
  create.mockReturnValue("blob:chosen");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  vi.stubGlobal("Image", class {
    naturalWidth = dimensions.width;
    naturalHeight = dimensions.height;
    onload?: () => void;
    onerror?: () => void;
    set src(_value: string) { queueMicrotask(() => imageFails ? this.onerror?.() : this.onload?.()); }
  });
  vi.mocked(cropImage).mockResolvedValue(new Blob(["crop"], { type: "image/png" }));
  vi.mocked(uploadMedia).mockResolvedValue({ ok: true, data: uploaded });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ImageField", () => {
  it("renders an accessible empty slot, guidance and draft error", () => {
    mount({ description: "Tu equipo", error: "Falta la portada" });
    expect(screen.getByRole("button", { name: /Subir.*Imagen de portada/ })).toHaveClass("border-dashed");
    expect(screen.getByText(/JPG, PNG o WebP · hasta 5 MB/)).toBeVisible();
    expect(screen.getByText(/1920 × 1080/)).toBeVisible();
    expect(screen.getByText("Tu equipo")).toBeVisible();
    expect(screen.getByText("Falta la portada")).toBeVisible();
  });
  it.each(["{Enter}", " "])("opens file selection with keyboard %s", async (key) => {
    mount();
    const input = screen.getByLabelText("Archivo de Imagen de portada");
    const click = vi.spyOn(input, "click");
    screen.getByRole("button", { name: /Subir.*Imagen de portada/ }).focus();
    await userEvent.keyboard(key);
    expect(click).toHaveBeenCalledOnce();
  });
  it.each([
    [new File(["gif"], "photo.gif", { type: "image/gif" }), "Usa una imagen JPG, PNG o WebP."],
    [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }), "La imagen pesa más de 5 MB."],
  ])("validates file metadata before opening the cropper", async (file, message) => {
    mount(); choose(file);
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    [199, 1200, "La imagen debe medir al menos 200 px por lado."],
    [1200, 199, "La imagen debe medir al menos 200 px por lado."],
    [6001, 1200, "La imagen debe medir como máximo 6000 px por lado."],
  ])("validates decoded dimensions %s × %s", async (width, height, message) => {
    dimensions = { width, height }; mount(); choose();
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith("blob:chosen");
  });
  it("reports unreadable images", async () => {
    imageFails = true; mount(); choose();
    expect(await screen.findByText("No pudimos leer la imagen. Elige otro archivo.")).toBeVisible();
    expect(revoke).toHaveBeenCalled();
  });
  it.each([ ["cover", 16 / 9], ["gallery", 4 / 3], ["portrait", 1], ["story", 1600 / 1200] ] as const)("opens %s with its aspect and keyboard movement", async (kind, aspect) => {
    mount({ kind }); await open();
    expect(screen.getByRole("img", { name: `Recorte ${aspect}` })).toHaveAttribute("data-keyboard-step", "10");
    expect(screen.getByRole("slider", { name: "Zoom" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus());
  });
  it("cancel preserves the current value and releases its URL", async () => {
    const { onChange } = mount(); await open();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:chosen");
  });
  it("crops, uploads and reports the new reference with media metadata", async () => {
    const { onChange } = mount(); await open();
    await userEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ media_id: "new-id" }, uploaded));
    expect(uploadMedia).toHaveBeenCalledWith("cover", expect.any(File));
    expect(cropImage).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:chosen");
  });
  it("shows upload state, returned failure and retries the exact cropped file", async () => {
    let finish!: (value: Awaited<ReturnType<typeof uploadMedia>>) => void;
    vi.mocked(uploadMedia).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { onChange } = mount(); await open();
    await userEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    expect(await screen.findByText("Subiendo imagen…")).toBeVisible();
    expect(screen.getByLabelText("Archivo de Imagen de portada")).toBeDisabled();
    await act(async () => finish({ ok: false, message: "La subida no está disponible." }));
    expect(await screen.findByText("La subida no está disponible.")).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar subida" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(uploadMedia).toHaveBeenCalledTimes(2);
    expect(vi.mocked(uploadMedia).mock.calls[0][1]).toBe(vi.mocked(uploadMedia).mock.calls[1][1]);
    expect(cropImage).toHaveBeenCalledOnce();
  });
  it.each([false, true])("uses the latest callback after deferred upload (retry: %s)", async retry => {
    let finish!: (value: Awaited<ReturnType<typeof uploadMedia>>) => void;
    if (retry) vi.mocked(uploadMedia).mockResolvedValueOnce({ ok: false, message: "Retry" });
    const { onChange, rerender } = mount();
    if (!retry) vi.mocked(uploadMedia).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    if (retry) {
      vi.mocked(uploadMedia).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      await userEvent.click(await screen.findByRole("button", { name: "Reintentar subida" }));
    }
    await screen.findByText("Subiendo imagen…");
    const latest = vi.fn();
    rerender(<ImageField kind="cover" label="Imagen de portada" value={null} onChange={latest} />);
    await act(async () => finish({ ok: true, data: uploaded }));
    expect(latest).toHaveBeenCalledWith({ media_id: uploaded.id }, uploaded);
    expect(onChange).not.toHaveBeenCalled();
  });
  it.each(["hero", "gallery"] as const)("preserves intervening %s form edits during upload", async type => {
    const block = defaultBlock(type);
    if (block.type === "gallery") block.content.items = [
      { image: null, alt: "First", caption: null }, { image: null, alt: "Second", caption: null },
    ];
    const draft = defaultSiteDraft();
    draft.blocks = [block];
    const initial = createEditorState({ draft, draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-01-01T00:00:00Z" }, '"1"');
    function Harness() {
      const [state, dispatch] = useReducer(editorReducer, initial);
      return <><SectionForm block={state.draft.blocks[0]} dispatch={dispatch} fieldErrors={[]} /><output data-testid="content">{JSON.stringify(state.draft.blocks[0].content)}</output></>;
    }
    let finish!: (value: Awaited<ReturnType<typeof uploadMedia>>) => void;
    vi.mocked(uploadMedia).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<Harness />);
    fireEvent.change(screen.getAllByLabelText(/^Archivo de /)[0], { target: { files: [new File(["image"], "photo.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Usar imagen" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    await screen.findByText("Subiendo imagen…");
    if (type === "gallery") fireEvent.click(screen.getByRole("button", { name: "Second" }));
    const input = type === "hero" ? screen.getByLabelText("Título principal") : screen.getAllByLabelText("Texto alternativo").at(-1)!;
    fireEvent.change(input, { target: { value: "Edited while uploading" } });
    await act(async () => finish({ ok: true, data: uploaded }));
    const content = JSON.parse(screen.getByTestId("content").textContent!);
    if (type === "hero") expect(content).toMatchObject({ title: "Edited while uploading", cover: { media_id: uploaded.id } });
    else expect(content.items).toEqual([
      { image: { media_id: uploaded.id }, alt: "First", caption: null },
      { image: null, alt: "Edited while uploading", caption: null },
    ]);
  });
  it("renders a filled slot and removes without a confirmation", async () => {
    const { onChange } = mount({ value: { media_id: "existing" }, previewUrl: () => "/media/existing" });
    expect(screen.getByRole("img", { name: "Imagen de portada" })).toHaveAttribute("src", "/media/existing");
    expect(screen.getByRole("button", { name: "Cambiar" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Quitar" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByRole("status")).toHaveTextContent("Imagen quitada");
  });
  it("accepts dropped files", async () => {
    mount();
    fireEvent.drop(screen.getByRole("button", { name: /Subir.*Imagen de portada/ }), { dataTransfer: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
    expect(await screen.findByRole("dialog")).toBeVisible();
  });
  it("disables selecting, dropping and removal", () => {
    const { onChange } = mount({ disabled: true, value: { media_id: "existing" } });
    expect(screen.getByRole("button", { name: "Cambiar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quitar" })).toBeDisabled();
    choose();
    expect(create).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("keeps the cropper open after an encoding failure without changing the value", async () => {
    vi.mocked(cropImage).mockRejectedValue(new Error("No pudimos recortar la imagen."));
    const { onChange } = mount(); await open();
    await userEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    expect(await screen.findByText("No pudimos recortar la imagen.")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
  });
  it("supports keyboard zoom using the installed slider", async () => {
    mount(); await open();
    const slider = screen.getByRole("slider", { name: "Zoom" });
    act(() => slider.focus());
    await userEvent.keyboard("{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "1.05");
  });
  it("releases a crop preview when unmounted before confirming", async () => {
    const { unmount } = mount(); await open(); unmount();
    expect(revoke).toHaveBeenCalledWith("blob:chosen");
    expect(uploadMedia).not.toHaveBeenCalled();
  });
  it("ignores a file dropped into a disabled empty slot", () => {
    mount({ disabled: true });
    fireEvent.drop(screen.getByRole("button", { name: /Subir.*Imagen de portada/ }), { dataTransfer: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
    expect(create).not.toHaveBeenCalled();
  });
  it("releases the pending URL on unmount and ignores late uploads", async () => {
    let finish!: (value: Awaited<ReturnType<typeof uploadMedia>>) => void;
    vi.mocked(uploadMedia).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount, onChange } = mount(); await open();
    await userEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    unmount();
    await act(async () => finish({ ok: true, data: uploaded }));
    expect(revoke).toHaveBeenCalledWith("blob:chosen");
    expect(onChange).not.toHaveBeenCalled();
  });
});
