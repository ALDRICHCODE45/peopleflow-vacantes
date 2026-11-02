/** T6 will honor this selection param in the existing applications inbox. */
export function applicationHref(id: string): string {
  return `/candidato/postulaciones?postulacion=${encodeURIComponent(id)}`;
}
