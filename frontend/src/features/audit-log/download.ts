const FALLBACK = "auditoria.csv";

/** The server names the file (`auditoria-YYYY-MM-DD.csv`); anything that is not a plain file name falls back. */
export function downloadFilename(disposition: string | null): string {
  const name = (disposition && /filename="?([^";]*)"?/i.exec(disposition)?.[1]) || "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name) ? name : FALLBACK;
}

/** Hands the blob to the browser's download manager; only ever called after a 200. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
