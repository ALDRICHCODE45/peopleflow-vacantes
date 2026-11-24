import type { Metadata } from "next";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { EmployerSettingsWorkspace } from "@/features/employer-settings/settings-workspace";

export const metadata: Metadata = { title: "Configuración" };

/** The workspace owns the identity strip and the rows (company identity and the owner-only talent base visibility use server actions); the page only adds the header. */
export default function Page() {
  return (
    <>
      <SiteHeader title="Configuración" />
      <EmployerSettingsWorkspace />
    </>
  );
}
