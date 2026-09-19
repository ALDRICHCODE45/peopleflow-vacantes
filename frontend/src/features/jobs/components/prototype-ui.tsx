import { ShieldCheckIcon } from "lucide-react";

/**
 * Presentation primitives shared by the local-only prototype surfaces (public
 * vacancy cards and the canonical detail). Everything here is server-safe: no
 * client directive, hook, state, request, or storage, and no raw color, because
 * every class comes from the PeopleFlow token layer. The metrics these
 * primitives render are fictional demo values supplied by
 * `PrototypeJobEnrichment`, and the caller owns wherever the disclosure and the
 * verification row appear.
 */

/** Exact disclosure every prototype metric or action must carry. */
export const PROTOTYPE_DISCLOSURE =
  "Datos y acciones de demostración: este prototipo no se conecta a ningún backend, no guarda información y no envía postulaciones reales.";

/** Tile sizes the monogram offers; radii and type scale together. */
const MONOGRAM_SIZES = {
  compact: "size-10 rounded-xl text-sm",
  default: "size-12 rounded-xl text-base",
} as const;

/** Compact tile for dense rows, default for a card or detail header. */
export type CompanyMonogramSize = keyof typeof MONOGRAM_SIZES;

/**
 * One or two mark initials for a company name. One word becomes its first two
 * code points with the first letter capitalized ("Acme" -> "Ac"); two or more
 * words become the first letter of the first and of the last word ("Acme
 * Technologies" -> "AT"). `Array.from` walks code points, so an accented or
 * astral letter is never split, and a blank name yields no mark at all.
 */
export function companyInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  const first = words[0];
  if (first === undefined) return "";
  if (words.length === 1) {
    const [head, tail] = Array.from(first);
    return head.toUpperCase() + (tail ?? "").toLowerCase();
  }
  const last = words[words.length - 1];
  return Array.from(first)[0].toUpperCase() + Array.from(last)[0].toUpperCase();
}

/** Spanish applicant count, with the singular only for exactly one. */
export function prototypeApplicantsLabel(count: number): string {
  return count === 1 ? "1 postulante" : `${count} postulantes`;
}

/** Spanish response estimate, with the singular only for exactly one day. */
export function prototypeResponseLabel(days: number): string {
  return `Responde en ~${days} ${days === 1 ? "día" : "días"}`;
}

/**
 * Decorative company mark: the initials tile of the reference cards and detail
 * header. It is `aria-hidden` on purpose, so the initials never leak into the
 * accessible name of the adjacent company text, and the brand gradient is
 * confined to the tile itself.
 */
export function CompanyMonogram({
  name,
  size = "default",
}: {
  name: string;
  size?: CompanyMonogramSize;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 select-none place-items-center bg-gradient-to-br from-primary to-primary/40 font-heading font-bold tracking-tight text-primary-foreground ${MONOGRAM_SIZES[size]}`}
    >
      {companyInitials(name)}
    </span>
  );
}

/**
 * Non-interactive verification row. It is deliberately not a button or a link:
 * the prototype only states that the process is verified, and the surrounding
 * disclosure, owned by the caller, says what that claim is worth.
 */
export function VerifiedByPeopleFlow() {
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0" />
      <span>Verificada por PeopleFlow</span>
    </p>
  );
}

/** The shared disclosure as an ARIA note in small text. */
export function PrototypeDisclosure() {
  return (
    <p role="note" className="text-xs leading-relaxed text-muted-foreground">
      {PROTOTYPE_DISCLOSURE}
    </p>
  );
}
