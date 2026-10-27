export type CropArea = { x: number; y: number; width: number; height: number };

/** Encodes only the chosen pixels; never upscales or retains source metadata. */
export async function cropImage(image: HTMLImageElement, area: CropArea, type: string): Promise<Blob> {
  const scale = Math.min(1, 2400 / Math.max(area.width, area.height));
  const width = Math.round(area.width * scale);
  const height = Math.round(area.height * scale);
  if (width < 200 || height < 200) {
    throw new Error("El recorte debe medir al menos 200 px por lado. Reduce el zoom.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No pudimos recortar la imagen. Inténtalo de nuevo.");
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.type === type) resolve(blob);
      else reject(new Error("No pudimos recortar la imagen. Inténtalo de nuevo."));
    }, type, type === "image/png" ? undefined : 0.9);
  });
}
