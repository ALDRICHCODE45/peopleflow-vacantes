import type { Metadata } from "next";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { NotificationPreferences } from "@/features/notifications/ui/notification-preferences";

export const metadata: Metadata = { title: "Notificaciones" };

/**
 * «Mis preferencias» of a company member (T4.2, design 05). Stakeholders never reach it: the `(empresa)` EmployerGuard
 * shows «Sección no disponible» for every route outside `stakeholderRoute`'s allowlist (contract Q7: hidden until stage 3).
 */
export default function Page() {
  return (
    <>
      <SiteHeader title="Notificaciones" parent={{ label: "Configuración", href: "/empresa/configuracion" }} />
      <DashboardPageContent width="full" className="mx-auto w-full max-w-[65rem]">
        <NotificationPreferences scope="company" />
      </DashboardPageContent>
    </>
  );
}
