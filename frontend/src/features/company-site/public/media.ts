/** Ignore the API-relative capability URL: the API origin is server-only. */
export function mediaUrl(id: string): string {
  return `/media/sitios/${encodeURIComponent(id)}`;
}
