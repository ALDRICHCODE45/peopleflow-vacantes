import type { Metadata } from "next";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { EmployerSettingsWorkspace } from "@/features/employer-settings/settings-workspace";

export const metadata: Metadata = { title: "Configuración" };

/** The employer layout owns the shell; only appearance persists on this device. */
export default function Page() {
  return (
    <>
      <SiteHeader title="Configuración" />
      <EmployerSettingsWorkspace />
    </>
  );
}
