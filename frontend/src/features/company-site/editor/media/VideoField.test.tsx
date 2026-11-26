import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoField, type VideoFieldProps } from "./VideoField";
import { checkHeroVideo, uploadHeroVideo, type HeroVideoUploadResult } from "./video-upload";

vi.mock("./video-upload", () => ({ checkHeroVideo: vi.fn(), uploadHeroVideo: vi.fn() }));
const id = "12345678-1234-4123-8123-123456789abc";
const created = { id, kind: "hero_video" as const, url: `/v2/company-sites/media/${id}`, width: null, height: null, duration_ms: 12000, content_type: "video/mp4" as const };
let reduced = false;
function mount(props: Partial<VideoFieldProps> = {}) {
  const onChange = vi.fn();
  const view = render(<VideoField label="Video de fondo" value={null} onChange={onChange} previewUrl={mediaId => `/media/sitios/${mediaId}`} {...props} />);
  return { ...view, onChange };
}
const file = () => new File(["x"], "fondo.mp4", { type: "video/mp4" });
const choose = (chosen = file()) => fireEvent.change(screen.getByLabelText("Archivo de Video de fondo"), { target: { files: [chosen] } });
beforeEach(() => {
  reduced = false;
  vi.mocked(checkHeroVideo).mockResolvedValue(null);
  vi.mocked(uploadHeroVideo).mockResolvedValue({ ok: true, data: created });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("reduce") && reduced, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("VideoField", () => {
  it("shows the four limits, the faststart tip and the poster note while empty", () => {
    mount();
    expect(screen.getByRole("button", { name: "Subir Video de fondo" })).toBeEnabled();
    expect(screen.getByText(/MP4 · hasta 20 MB · hasta 30 segundos/)).toBeInTheDocument();
    expect(screen.getByText(/Se reproduce sin sonido y en bucle/)).toBeInTheDocument();
    expect(screen.getByText(/Expórtalo como MP4 normal con "inicio rápido" \(faststart\) para que empiece más rápido\./)).toBeInTheDocument();
    expect(screen.getByText(/«Imagen de portada» es el póster/)).toBeInTheDocument();
    expect(screen.getByLabelText("Archivo de Video de fondo")).toHaveAttribute("accept", "video/mp4,.mp4");
  });
  it("pre-checks the file and shows its message without uploading", async () => {
    vi.mocked(checkHeroVideo).mockResolvedValue("El video dura más de 30 segundos.");
    const { onChange } = mount();
    choose();
    expect(await screen.findByText("El video dura más de 30 segundos.")).toBeInTheDocument();
    expect(uploadHeroVideo).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("uploads with progress («Subiendo…») and stores the media ref", async () => {
    let finish!: (result: HeroVideoUploadResult) => void;
    vi.mocked(uploadHeroVideo).mockImplementation((_file, { onProgress }) => { onProgress?.(0.42); return new Promise(resolve => { finish = resolve; }); });
    const { onChange } = mount();
    choose();
    expect(await screen.findByText(/Subiendo… 42 %/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByRole("button", { name: "Subir Video de fondo" })).toBeDisabled();
    finish({ ok: true, data: created });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ media_id: id }, created));
    expect(await screen.findByText("Video actualizado")).toBeInTheDocument();
  });
  it("can cancel an upload in progress", async () => {
    vi.mocked(uploadHeroVideo).mockImplementation((_file, { signal }) => new Promise(resolve => signal?.addEventListener("abort", () => resolve({ ok: false, message: null }))));
    const { onChange } = mount();
    choose();
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar subida" }));
    await waitFor(() => expect(screen.queryByText(/Subiendo/)).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows a backend failure and retries the same file", async () => {
    vi.mocked(uploadHeroVideo).mockResolvedValueOnce({ ok: false, message: "El video pesa más de 20 MB." });
    const { onChange } = mount();
    choose();
    expect(await screen.findByText("El video pesa más de 20 MB.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar subida" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ media_id: id }, created));
    expect(checkHeroVideo).toHaveBeenCalledTimes(1);
  });
  it("previews the stored video muted, looped and inline, with replace and remove", () => {
    const { onChange, container } = mount({ value: { media_id: id } });
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", `/media/sitios/${id}`);
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("loop");
    expect(video).toHaveAttribute("playsinline");
    expect(video.autoplay).toBe(true);
    expect(screen.getByRole("button", { name: "Cambiar video" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Quitar video" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
  it("doesn't autoplay the preview under reduced motion", () => {
    reduced = true;
    const { container } = mount({ value: { media_id: id } });
    expect(container.querySelector("video")!.autoplay).toBe(false);
  });
  it("shows a draft field error", () => {
    mount({ error: "Sube el video de fondo para publicar." });
    expect(screen.getByText("Sube el video de fondo para publicar.")).toBeInTheDocument();
  });
});
