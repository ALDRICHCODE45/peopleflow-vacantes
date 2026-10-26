import type { ReactNode } from "react";
import { VacancyHeader } from "@/components/candidate-dashboard/vacancy-header";

/** Public vacancy content keeps its own h1 and server reads inside the app frame. */
export default function VacancyLayout({ children }: { children: ReactNode }) {
  return <>
    <VacancyHeader />
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">{children}</div>
  </>;
}
