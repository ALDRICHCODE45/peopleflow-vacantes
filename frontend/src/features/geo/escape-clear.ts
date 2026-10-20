/** Base UI clears a combobox on Escape while its list is closed (reason "escape-key"); with
 * chips that silently wiped every chosen country. Ignore only that change. */
export function ignoreEscapeClear<T>(apply: (value: T) => void) {
  return (value: T, details?: { reason?: string }) => { if (details?.reason !== "escape-key") apply(value); };
}
