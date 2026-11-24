import type { ReactNode } from "react";
import { VacancyHeader } from "@/components/candidate-dashboard/vacancy-header";

/** Public vacancy content keeps its own h1 and server reads inside the app frame. */
export default function VacancyLayout({ children }: { children: ReactNode }) {
  return <>
    {/* Same «Ir al contenido» skip link as /candidatos: it jumps past the header's menu and breadcrumb. */}
    <a href="#contenido-vacantes" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-card focus:p-4 focus:text-foreground focus:outline-2 focus:outline-ring">Ir al contenido</a>
    <VacancyHeader />
    <div id="contenido-vacantes" tabIndex={-1} className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 outline-none lg:px-6">{children}</div>
  </>;
}
