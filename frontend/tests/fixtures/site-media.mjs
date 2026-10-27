import { randomUUID } from "node:crypto";

// A review-only image header reader, not the production image sanitizer/storage
// adapter. Accept real PNG/JPEG/WebP bytes, never trust the multipart MIME label.
function dimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR") {
    return { content_type: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X" && !(bytes[20] & 2)) return { content_type: "image/webp", width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (chunk === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) return { content_type: "image/webp", width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L" && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21);
      return { content_type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes.length > 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) return { content_type: "image/jpeg", width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      offset += 2 + length;
    }
  }
  return null;
}

export async function receiveSiteMedia(request, store, json) {
  // Bound the multipart envelope as well as the file; never write uploads to disk.
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 5 * 1024 * 1024 + 65536) {
      json(413, { error: "Archivo demasiado grande", code: "payload_too_large" });
      return;
    }
    chunks.push(chunk);
  }
  let form;
  try {
    form = await new Request("http://fixture.local/media", { method: "POST", headers: { "content-type": request.headers["content-type"] ?? "" }, body: Buffer.concat(chunks) }).formData();
  } catch { return json(400, { error: "Multipart inválido", code: "invalid_request" }); }
  const kind = form.get("kind");
  const file = form.get("file");
  if ([...form.keys()].length !== 2 || !["cover", "gallery", "portrait", "story"].includes(kind) || !file || typeof file === "string" || form.getAll("file").length !== 1 || form.getAll("kind").length !== 1) return json(400, { error: "Se requieren kind y file", code: "invalid_request" });
  if (file.size > 5 * 1024 * 1024) return json(413, { error: "Archivo demasiado grande", code: "payload_too_large" });
  const bytes = Buffer.from(await file.arrayBuffer());
  const image = dimensions(bytes);
  if (!image) return json(415, { error: "Imagen no compatible", code: "unsupported_media_type" });
  if (Math.min(image.width, image.height) < 200) return json(422, { error: "Imagen pequeña", code: "image_too_small" });
  if (Math.max(image.width, image.height) > 6000) return json(422, { error: "Imagen grande", code: "image_too_large" });
  if (store.size >= 300) return json(422, { error: "Límite de imágenes", code: "media_limit_reached" });
  const id = randomUUID();
  const media = { id, kind, url: `/v2/company-sites/media/${id}`, ...image };
  store.set(id, { media, bytes });
  return json(201, media);
}
