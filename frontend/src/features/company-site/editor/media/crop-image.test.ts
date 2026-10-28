import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cropImage } from "./crop-image";

describe("cropImage", () => {
  const drawImage = vi.fn();
  const toBlob = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLCanvasElement);
    toBlob.mockImplementation((callback: BlobCallback, type: string) => callback(new Blob(["cropped"], { type })));
  });
  afterEach(() => vi.restoreAllMocks());
  it.each(["image/jpeg", "image/webp", "image/png"])("scales the selected area, preserves %s and encodes it", async (type) => {
    const image = {} as HTMLImageElement;
    const blob = await cropImage(image, { x: 100, y: 50, width: 4800, height: 2700 }, type);
    expect(canvas.width).toBe(2400);
    expect(canvas.height).toBe(1350);
    expect(drawImage).toHaveBeenCalledWith(image, 100, 50, 4800, 2700, 0, 0, 2400, 1350);
    expect(blob.type).toBe(type);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), type, type === "image/png" ? undefined : 0.9);
  });
  it("does not upscale", async () => {
    await cropImage({} as HTMLImageElement, { x: 0, y: 0, width: 600, height: 800 }, "image/png");
    expect([canvas.width, canvas.height]).toEqual([600, 800]);
  });
  it("rejects a crop smaller than the upload minimum", async () => {
    await expect(cropImage({} as HTMLImageElement, { x: 0, y: 0, width: 199, height: 300 }, "image/png")).rejects.toThrow("200 px");
  });
  it("reports an encoding failure", async () => {
    toBlob.mockImplementation((callback: BlobCallback) => callback(null));
    await expect(cropImage({} as HTMLImageElement, { x: 0, y: 0, width: 400, height: 400 }, "image/png")).rejects.toThrow();
  });
});
