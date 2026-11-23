import type { NextConfig } from "next";

/** Canonical 8-4-4-4-12 UUID, the same shape `isValidJobId` accepts; any other id falls through to the page's `notFound()`. */
const VACANCY_ID = ":jobId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The Configuración tab opens at its first module. This is an HTTP redirect, not a page-level `redirect()`: a page-level one
      // reaches an in-flight client navigation as a redirect error that `RedirectBoundary` turns into a second `router.replace`
      // after the render, which races a Link click on another tab («Rendered more hooks than during the previous render»). An HTTP
      // redirect is resolved inside the single router action, so there is nothing left to race.
      { source: `/empresa/vacantes/${VACANCY_ID}/configuracion`, destination: "/empresa/vacantes/:jobId/configuracion/columnas", permanent: false },
    ];
  },
};

export default nextConfig;
