import { notFound } from "next/navigation";

// notFound supplies the noindex robots metadata; declaring it here as well
// would duplicate the tag in the rendered not-found document.

// Internal malformed-ID destination, intentionally outside /vacantes loading.
// Direct visits receive the same 404; no API or environment access is needed.
export default function VacanteNoEncontradaPage() {
  notFound();
}
